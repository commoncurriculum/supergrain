# Supergrain

Reactive state management for React — with an API query layer built on top.

- **[@supergrain/kernel](./packages/kernel)** is the state library. Read and mutate plain objects; only the components that actually touched the changed property re-render.
- **[@supergrain/silo](./packages/silo)** is an API query layer built on top. Request-batched by default, Suspense-compatible, typed by model. Fetched documents live in the same reactive graph as the rest of your state.

On [Krauset's js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/current.html), Supergrain ties raw `useState` (1.52 weighted) and beats every other state library — RxJS, Zustand, MobX, Redux, Valtio.

## State: `@supergrain/kernel`

Mutate state directly. No actions, no reducers, no selectors, no `useMemo` / `useCallback` dance.

```tsx
import { tracked, useReactive, For } from "@supergrain/kernel/react";

const TodoList = tracked(() => {
  const state = useReactive({
    todos: [
      { id: 1, text: "Ship it", done: false },
      { id: 2, text: "Sleep", done: true },
    ],
  });

  return (
    <For each={state.todos}>
      {(todo) => (
        <li onClick={() => (todo.done = !todo.done)}>
          {todo.done ? "✓" : "○"} {todo.text}
        </li>
      )}
    </For>
  );
});
```

Click a todo and only that one `<li>` re-renders. Not the list. Not the siblings. No keys, no memoization.

`useReactive` is for component-scoped state; `createStore` is for app-wide state with a Provider. Writes are synchronous (read your own writes immediately); deep mutations (`store.org.teams[0].active = true`) are tracked at any nesting depth.

[Full kernel docs →](./packages/kernel/README.md)

## Queries: `@supergrain/silo`

An entity cache with request batching. Think TanStack Query, except the fetched documents are reactive state you can also mutate directly — one cache, not two.

Declare your models and adapters, build the store, then read documents anywhere in the tree:

```tsx
import { createDocumentStore, type DocumentAdapter } from "@supergrain/silo";
import { createDocumentStoreContext } from "@supergrain/silo/react";

// 1. Model + adapter. The adapter takes N ids and returns raw docs.
interface User {
  id: string;
  attributes: { firstName: string; lastName: string };
}
type Models = { user: User };

const userAdapter: DocumentAdapter = {
  async find(ids) {
    return Promise.all(ids.map((id) => fetch(`/api/users/${id}`).then((r) => r.json())));
  },
};

// 2. Context factory — one store type, one Provider, typed hooks.
const { Provider, useDocument } = createDocumentStoreContext<Models>();

// 3. Mount the Provider once. `init` runs per mount → SSR/tests are isolated.
function App() {
  return (
    <Provider
      init={() =>
        createDocumentStore<Models>({
          models: { user: { adapter: userAdapter } },
        })
      }
    >
      <UserList />
    </Provider>
  );
}

// 4. Read documents by (type, id). `useDocument` returns a stable, reactive handle.
function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);
  if (user.isPending) return <Skeleton />;
  if (user.error) return <ErrorState error={user.error} />;
  return <div>{user.data?.attributes.firstName}</div>;
}
```

The adapter above is **fan-out** style — N parallel `GET /:id` requests per batch, merged. If your API has a bulk endpoint, return all the docs from one `fetch` instead; silo doesn't care how you hit the wire. Either way, rendering 50 `<UserCard>`s in one pass collapses to **one** `userAdapter.find(ids)` call — batching is automatic, not opt-in. Handles are reactive: a later `store.insertDocument("user", updated)` (socket push, mutation response, admin edit) re-renders just the cards whose data changed — no query keys, no `invalidateQueries`.

Opt into Suspense with one line at the call site (`use(user.promise)`); leave it out to keep inline loading UI. Both shapes are supported from the same hook.

[Full silo docs →](./packages/silo/README.md)

## Install

```bash
# State only
npm install @supergrain/kernel

# State + API queries
npm install @supergrain/kernel @supergrain/silo
```

The React bindings ship in the same packages (`@supergrain/kernel/react`, `@supergrain/silo/react`) and require `react >= 18.2`.

## Also available

- **[@supergrain/mill](./packages/mill/README.md)** — MongoDB-style update operators (`$set`, `$inc`, `$push`, `$pull`, `$addToSet`, `$min`, `$max`, `$unset`) for batched, path-aware writes. Optional — plain `store.x = 1` is the usual path; reach for `mill` when you want to apply several updates atomically or use dot notation for deeply nested writes.

## Comparison

[Side-by-side with useState, Zustand, Redux, MobX →](./docs/comparison.md)

## Contributing

Contributions welcome. Clone, install, test:

```bash
git clone https://github.com/commoncurriculum/supergrain.git
cd supergrain
pnpm install
pnpm -r --filter="@supergrain/*" build
pnpm test
pnpm run typecheck
```

### Releases

This project uses [Changesets](https://github.com/changesets/changesets) for automated releases. Create one via the [Add Changeset workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml) or with `pnpm changeset`. GitHub Actions handles versioning, changelogs, and NPM publishing.

- [NPM Setup Guide](https://github.com/commoncurriculum/supergrain/blob/main/notes/publishing/npm-setup.md)
- [Releasing Guide](https://github.com/commoncurriculum/supergrain/blob/main/notes/publishing/releasing.md)

## License

MIT
