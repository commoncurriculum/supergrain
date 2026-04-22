# Supergrain

Reactive primitives for React, and the document store built on top of them.

Supergrain is two libraries:

- **[@supergrain/kernel](./packages/kernel)** — a fast, ergonomic reactive store. Plain-object reads and writes, fine-grained re-renders, no selectors.
- **[@supergrain/silo](./packages/silo)** — a Suspense-compatible document cache built on the kernel. Request-batched, stable handles, typed by model.

Plus one optional helper:

- **[@supergrain/mill](./packages/mill)** — MongoDB-style update operators (`$set`, `$inc`, `$push`, ...) for batched, path-aware writes.

## When to reach for each

- **Local / app state → kernel.** Single-page state, component-scoped state, shared-across-the-app state. If it lives in memory and doesn't come from the network, this is the one.
- **Server data → silo.** Anything you fetch by id or query. Documents with identity, JSON-API envelopes, cross-component sharing of fetched data.
- **Complex or batched writes → mill.** Reach for it only when you want the MongoDB operator vocabulary; everyday writes are just `store.x = 1`.

## A taste

### kernel

```tsx
import { tracked, useReactive, For } from "@supergrain/kernel/react";

const TodoList = tracked(() => {
  const { todos } = useReactive({
    todos: [
      { id: 1, text: "Ship it", done: false },
      { id: 2, text: "Sleep", done: true },
    ],
  });

  return (
    <For each={todos}>
      {(todo) => (
        <li onClick={() => (todo.done = !todo.done)}>
          {todo.done ? "✓" : "○"} {todo.text}
        </li>
      )}
    </For>
  );
});
```

Only the item you click re-renders. No keys, no memoization, no selectors.

### silo

```tsx
import { useDocument } from "@supergrain/silo/react";

function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);

  if (user.isPending) return <Skeleton />;
  if (user.error) return <ErrorState error={user.error} />;
  return <div>{user.data?.attributes.firstName}</div>;
}
```

N `UserCard`s in one render collapse into one `adapter.find(ids)` call. No query keys, no options bags.

### mill

```ts
import { update } from "@supergrain/mill";

update(store, {
  $set: { "user.name": "Bob" },
  $inc: { count: 2 },
  $push: { items: "g" },
});
```

All three operators apply atomically under one batch.

## Install

```bash
# Reactive primitives
npm install @supergrain/kernel

# Document store
npm install @supergrain/silo @supergrain/kernel

# Update operators (optional)
npm install @supergrain/mill @supergrain/kernel
```

## Full docs

- **Kernel** — [quick start, API, features, FAQ](./packages/kernel/README.md)
- **Silo** — [quick start, API, batching, processors, comparison to TanStack Query](./packages/silo/README.md)
- **Mill** — [operator reference](./packages/mill/README.md)
- **Comparison guide** — [side-by-side with useState, Zustand, Redux, MobX](./docs/comparison.md)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development

```bash
git clone https://github.com/commoncurriculum/supergrain.git
cd supergrain
pnpm install
pnpm -r --filter="@supergrain/*" build
pnpm test
pnpm run typecheck
```

### Publishing Releases

This project uses [Changesets](https://github.com/changesets/changesets) for automated releases. You can create changesets via:

- **GitHub UI**: Use the [Add Changeset workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml) (no terminal needed!)
- **Terminal**: Run `pnpm changeset`

GitHub Actions automatically handles versioning, changelogs, and publishing to NPM.

- [NPM Setup Guide](https://github.com/commoncurriculum/supergrain/blob/main/notes/publishing/npm-setup.md) — Complete guide for setting up NPM publishing
- [Releasing Guide](https://github.com/commoncurriculum/supergrain/blob/main/notes/publishing/releasing.md) — Step-by-step instructions for creating releases

## License

MIT
