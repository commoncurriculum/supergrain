# Supergrain

A fast, ergonomic reactive store for React.

- **Plain objects** — read properties, assign values, push to arrays. No special syntax.
- **Fine-grained** — only the components that read changed properties re-render
- **Synchronous** — state updates are immediate, not deferred to the next render
- **Type-safe** — full TypeScript inference on stores and mutations
- **Zero boilerplate** — no actions, reducers, or selectors

## Install

```bash
npm install @supergrain/core @supergrain/react
```

## Quick Start

```typescript
// [#DOC_TEST_QUICK_START](packages/doc-tests/tests/readme-react.test.tsx)

import { createStore } from '@supergrain/core'
import { tracked, provideStore, useComputed, useSignalEffect, For } from '@supergrain/react'

// ---- Store ------------------------------------------------------------------

interface Todo { id: number; text: string; completed: boolean }
interface AppState { todos: Todo[]; selected: number | null }

const store = createStore<AppState>({
  todos: [
    { id: 1, text: 'Learn Supergrain', completed: false },
    { id: 2, text: 'Build something', completed: false },
  ],
  selected: null,
})

const Store = provideStore(store)

// ---- Components  -------------

const TodoItem = tracked(({ todo }: { todo: Todo }) => {
  const store = Store.useStore()
  const isSelected = useComputed(() => store.selected === todo.id)

  return (
    <li className={isSelected ? 'selected' : ''}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => todo.completed = !todo.completed}
      />
      {todo.text}
    </li>
  )
})

const App = tracked(() => {
  const store = Store.useStore()
  const remaining = useComputed(() => store.todos.filter(t => !t.completed).length)

  useSignalEffect(() => {
    document.title = `${remaining} items left`
  })

  return (
    <div>
      <h1>Todos ({remaining})</h1>
      <For each={store.todos}>
        {todo => <TodoItem key={todo.id} todo={todo} />}
      </For>
    </div>
  )
})

// ---- Render -----------------------------------------------------------------

<Store.Provider><App /></Store.Provider>
```

Checking a todo re-renders only that `TodoItem`. Changing selection re-renders only the 2 affected items. The `App` component and other items don't re-render.

- **`createStore<T>(initial)`** — Creates a reactive store proxy. Reads and writes work like plain objects.

- **`provideStore(store)`** — Wraps a store with React context plumbing. Returns `{ Provider, useStore }`. The proxy's identity never changes, so the context value is stable and won't trigger React re-renders.

- **`tracked(Component)`** — Wraps a React component with per-component signal scoping. Only the signals read during render are tracked — when they change, only this component re-renders.

- **`useComputed(() => expr, deps?)`** — Derived value that acts as a **firewall**. Re-evaluates when upstream signals change, but only triggers a re-render when the **result** changes. Also works with proxy props directly (`useComputed(() => item.label.toUpperCase())`). Optional `deps` array controls when the computed is recreated (like `useMemo`).

- **`useSignalEffect(() => sideEffect)`** — Signal-tracked side effect tied to the component lifecycle. Re-runs when tracked signals change, cleans up on unmount. Does **not** cause the component to re-render.

- **`<For each={array} parent={ref?}>{item => ...}</For>`** — Optimized list rendering. Tracks which items actually changed and only re-renders those. When a `parent` ref is provided, swaps use O(1) direct DOM moves instead of O(n) React reconciliation.

## Synchronous Writes and Batching

Writes are **synchronous** — you can always read your own writes:

```ts
store.count = 5;
console.log(store.count); // 5 — immediately available
```

Single mutations are always safe. When you need to make **multiple mutations atomically**, wrap them in `startBatch` / `endBatch`. Without batching, each write fires reactive effects immediately — a `computed` that reads both swapped positions would run mid-swap and see a duplicate:

```ts
// ❌ Without batching — computed sees [C, B, C] after first write
const tmp = store.data[0];
store.data[0] = store.data[2]; // effects fire — data is [C, B, C]
store.data[2] = tmp; // effects fire again — data is [C, B, A]
```

Wrap multi-step mutations in `startBatch` / `endBatch` so effects fire once with the final state:

```ts
import { startBatch, endBatch } from "@supergrain/core";

startBatch();
const tmp = store.data[0];
store.data[0] = store.data[2];
store.data[2] = tmp;
endBatch(); // effects fire once — data is [C, B, A]
```

---

## Comparison

The same operations in other React state libraries:

### Supergrain

```typescript
// [#DOC_TEST_52](packages/doc-tests/tests/readme-core.test.ts)

interface State { count: number; user: { profile: { name: string } } }
const store = createStore<State>({ count: 0, user: { profile: { name: 'John' } } })

// Mutate
store.count = 5

// Deep nested
store.user.profile.name = 'Bob'

// Fine-grained — only re-renders when count changes
const Counter = tracked(() => {
  return <p>{store.count}</p>
})
```

### useState

```typescript
// [#DOC_TEST_53](packages/doc-tests/tests/readme-core.test.ts)

const [state, setState] = useState<State>({
  count: 0,
  user: { profile: { name: "John" } },
});

// Mutate
setState((prev) => ({ ...prev, count: 5 }));

// Deep nested
setState((prev) => ({
  ...prev,
  user: { ...prev.user, profile: { ...prev.user.profile, name: "Bob" } },
}));

// Fine-grained — ❌ not possible. Re-renders on ANY state change.
```

### Zustand

```typescript
// [#DOC_TEST_54](packages/doc-tests/tests/readme-core.test.ts)

const useStore = create<State>()((set) => ({
  count: 0,
  user: { profile: { name: 'John' } },
}))

// Mutate
set({ count: 5 })

// Deep nested — manual spreading
set(state => ({
  user: { ...state.user, profile: { ...state.user.profile, name: 'Bob' } }
}))

// Fine-grained — requires selector
const Counter = () => {
  const count = useStore(state => state.count)
  return <p>{count}</p>
}
```

### Redux / RTK

```typescript
// [#DOC_TEST_55](packages/doc-tests/tests/readme-core.test.ts)

const slice = createSlice({
  name: 'app',
  initialState: { count: 0, user: { profile: { name: 'John' } } } as State,
  reducers: {
    setCount: (state, action) => { state.count = action.payload },
    setName: (state, action) => { state.user.profile.name = action.payload },
  },
})

// Mutate — need a reducer for each mutation
dispatch(setCount(5))

// Deep nested — need a reducer for each path
dispatch(setName('Bob'))

// Fine-grained — requires useSelector
const Counter = () => {
  const count = useSelector((state: RootState) => state.app.count)
  return <p>{count}</p>
}
```

### MobX

```typescript
// [#DOC_TEST_56](packages/doc-tests/tests/readme-core.test.ts)

class AppStore {
  count = 0
  user = { profile: { name: 'John' } }
  constructor() { makeAutoObservable(this) }
}
const store = new AppStore()

// Mutate
store.count = 5

// Deep nested
store.user.profile.name = 'Bob'

// Fine-grained — requires observer + makeAutoObservable ceremony
const Counter = observer(() => {
  return <p>{store.count}</p>
})
```

---

## Benchmarks

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (Krause benchmarks), median of 5 runs. Lower is better.

### Speed (ms)

| Benchmark                   | Supergrain | React Hooks | Zustand |
| --------------------------- | ---------: | ----------: | ------: |
| Create 1,000 rows           |       46.0 |        44.4 |    46.4 |
| Replace 1,000 rows          |       55.7 |        52.6 |    52.7 |
| Partial update (every 10th) |       32.5 |        32.3 |    28.8 |
| Select row                  |       14.8 |         9.1 |    11.8 |
| Swap rows                   |      177.7 |       178.0 |   184.0 |
| Remove row                  |       27.3 |        23.2 |    20.9 |
| Create 10,000 rows          |      639.4 |       585.0 |   633.5 |
| Append 1,000 rows           |       55.9 |        50.6 |    53.3 |
| Clear rows                  |   **32.2** |        31.5 |    38.6 |

### Memory (MB)

| Benchmark                   | Supergrain | React Hooks | Zustand |
| --------------------------- | ---------: | ----------: | ------: |
| Ready memory                |    **1.0** |         1.2 |     1.1 |
| After 1,000 rows            |        5.1 |     **4.4** |     6.1 |
| After 5 create/clear cycles |        2.1 |         1.9 |     1.9 |

Supergrain delivers fine-grained reactivity with per-component signal scoping at no meaningful performance cost compared to plain React hooks — while providing a dramatically simpler API than Zustand or Redux.

---

## Update Operators (Optional)

For complex updates — batched mutations, array manipulations, dot-notation paths — import `update` and pass the store as the first argument:

```typescript
// [#DOC_TEST_46](packages/doc-tests/tests/readme-core.test.ts)

import { createStore, update } from "@supergrain/core";

const store = createStore({
  count: 0,
  user: { name: "John", age: 30, middleName: "M" },
  items: ["a", "b", "c"],
  tags: ["react"],
  lowestScore: 100,
  highestScore: 50,
});

// $set — set values (supports dot notation for nested paths)
update(store, { $set: { count: 10, "user.name": "Alice" } });

// $unset — remove fields
update(store, { $unset: { "user.middleName": 1 } });

// $inc — increment/decrement numbers
update(store, { $inc: { count: 1 } });
update(store, { $inc: { count: -5 } });

// $push — add to arrays (with $each for multiple)
update(store, { $push: { items: "d" } });
update(store, { $push: { items: { $each: ["e", "f"] } } });

// $pull — remove from arrays
update(store, { $pull: { items: "b" } });

// $addToSet — add only if not already present
update(store, { $addToSet: { tags: "vue" } });

// $min / $max — conditional updates
update(store, { $min: { lowestScore: 50 } });
update(store, { $max: { highestScore: 100 } });

// Batching — multiple operators in one call
update(store, {
  $set: { "user.name": "Bob" },
  $inc: { count: 2 },
  $push: { items: "g" },
});
```

---

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

- [NPM_SETUP.md](NPM_SETUP.md) - Complete guide for setting up NPM publishing
- [RELEASING.md](RELEASING.md) - Step-by-step instructions for creating releases

## License

MIT
