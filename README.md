# Supergrain

A fast, ergonomic reactive store for React.

- **Plain objects** — read properties, assign values, push to arrays. No special syntax.
- **Fine-grained** — only the components that read changed properties re-render
- **Synchronous** — state updates are immediate, not deferred to the next render
- **Type-safe** — full TypeScript inference on stores and mutations
- **Zero boilerplate** — no actions, reducers, selectors, or providers

## Install

```bash
npm install @supergrain/core @supergrain/react
```

## Quick Start

```typescript
// [#DOC_TEST_32](packages/doc-tests/tests/readme-react.test.tsx)

import { createStore, computed, effect } from '@supergrain/core'
import { tracked, For } from '@supergrain/react'

interface Todo { id: number; text: string; completed: boolean }

const [store] = createStore<{ todos: Todo[] }>({
  todos: [
    { id: 1, text: 'Learn Supergrain', completed: false },
    { id: 2, text: 'Build something', completed: false },
  ],
})

const TodoItem = tracked(({ todo }: { todo: Todo }) => (
  <li>
    <input
      type="checkbox"
      checked={todo.completed}
      onChange={() => todo.completed = !todo.completed}
    />
    {todo.text}
  </li>
))

const App = tracked(() => {
  const remaining = computed(() => store.todos.filter(t => !t.completed).length)

  effect(() => document.title = `${remaining()} items left`)

  return (
    <div>
      <h1>Todos ({remaining()})</h1>
      <For each={store.todos}>
        {todo => <TodoItem key={todo.id} todo={todo} />}
      </For>
    </div>
  )
})
```

Checking a todo re-renders only that `TodoItem` — the `App` component and other items don't re-render.

## `<For>` Component

`<For>` optimizes list rendering. With `.map()` + `React.memo()`, React still calls the memo comparison function for every item whenever the array changes. `<For>` tracks which items actually changed and only re-renders those:

```typescript
// [#DOC_TEST_39](packages/doc-tests/tests/readme-react.test.tsx)

import { For } from '@supergrain/react'

const [store] = createStore({
  todos: [
    { id: 1, text: 'Task 1', completed: false },
    { id: 2, text: 'Task 2', completed: true },
  ],
})

const TodoItem = tracked(({ todo }: { todo: any }) => (
  <div className={todo.completed ? 'completed' : ''}>
    {todo.text}
  </div>
))

const TodoList = tracked(() => (
  <For each={store.todos} fallback={<div>No todos yet</div>}>
    {todo => <TodoItem key={todo.id} todo={todo} />}
  </For>
))
```

## Comparison

The same operations in other React state libraries:

### Supergrain

```typescript
// [#DOC_TEST_52](packages/doc-tests/tests/readme-core.test.ts)

interface State { count: number; user: { profile: { name: string } } }
const [store] = createStore<State>({ count: 0, user: { profile: { name: 'John' } } })

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

const [state, setState] = useState<State>({ count: 0, user: { profile: { name: "John" } } });

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
| Swap rows                   |  **177.7** |       178.0 |   184.0 |
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

## Synchronous Writes and Batching

Supergrain writes are **synchronous** — you can always read your own writes:

```typescript
store.count = 5;
console.log(store.count); // 5 — immediately available
```

This means there is no auto-batching via microtask or deferred update queue. Each write fires its reactive effects immediately. For single mutations this is ideal — the state is always consistent and readable.

When you need to make **multiple mutations atomically**, use `startBatch` / `endBatch` to group them. Without batching, each write triggers effects independently, which means:

1. Subscribers may see **intermediate state** between writes
2. Effects and computed signals run multiple times instead of once

```typescript
import { createStore, startBatch, endBatch } from "@supergrain/core";

const [store] = createStore({
  data: [
    { id: 1, label: "A" },
    { id: 2, label: "B" },
    { id: 3, label: "C" },
  ],
});

// ❌ Without batching — effects fire twice, once after each write
const tmp = store.data[0];
store.data[0] = store.data[2]; // effects fire here (intermediate state!)
store.data[2] = tmp; // effects fire again

// ✅ With batching — effects fire once, after both writes
startBatch();
const tmp2 = store.data[0];
store.data[0] = store.data[2];
store.data[2] = tmp2;
endBatch(); // effects fire here, seeing final state
```

> **Note:** The `update()` function returned by `createStore` already batches internally — you only need `startBatch` / `endBatch` when doing multiple direct proxy mutations.

---

## Update Operators (Optional)

For complex updates — batched mutations, array manipulations, dot-notation paths — `createStore` also returns an optional `update` function with MongoDB-style operators:

```typescript
// [#DOC_TEST_46](packages/doc-tests/tests/readme-core.test.ts)

const [state, update] = createStore({
  count: 0,
  user: { name: "John", age: 30, middleName: "M" },
  items: ["a", "b", "c"],
  tags: ["react"],
  lowestScore: 100,
  highestScore: 50,
});

// $set — set values (supports dot notation for nested paths)
update({ $set: { count: 10, "user.name": "Alice" } });

// $unset — remove fields
update({ $unset: { "user.middleName": 1 } });

// $inc — increment/decrement numbers
update({ $inc: { count: 1 } });
update({ $inc: { count: -5 } });

// $push — add to arrays (with $each for multiple)
update({ $push: { items: "d" } });
update({ $push: { items: { $each: ["e", "f"] } } });

// $pull — remove from arrays
update({ $pull: { items: "b" } });

// $addToSet — add only if not already present
update({ $addToSet: { tags: "vue" } });

// $min / $max — conditional updates
update({ $min: { lowestScore: 50 } });
update({ $max: { highestScore: 100 } });

// Batching — multiple operators in one call
update({
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
