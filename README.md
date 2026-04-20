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

Supergrain has two APIs for state. Use `useReactive` for state that lives inside a single component. Use `createStore` for state shared across your app.

### Local state — `useReactive`

For state scoped to a single component, `useReactive` returns a reactive proxy that lives for the component's lifetime. No Provider, no setup — mutate it like a plain object.

```tsx
// [#DOC_TEST_LOCAL_STATE](packages/doc-tests/tests/readme-react.test.tsx)

import { tracked, useReactive } from "@supergrain/react";

const Counter = tracked(() => {
  const state = useReactive({ count: 0 });
  return <button onClick={() => state.count++}>Clicked {state.count} times</button>;
});
```

Wrap the component in `tracked()` to get fine-grained re-renders: only the properties you read are tracked.

### App-wide state — `createStore`

For state shared across components, `createStore` returns a `Provider` and a `useStore` hook bound to one typed store. The Provider builds a fresh store on each mount, so SSR requests and tests are isolated by construction.

**Step 1: Define the store.** The initializer runs once per Provider mount.

```tsx
// [#DOC_TEST_QUICK_START](packages/doc-tests/tests/readme-react.test.tsx)
// store.ts
import { createStore } from "@supergrain/react";

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}
export interface AppState {
  todos: Todo[];
  selected: number | null;
}

export const { Provider, useStore } = createStore<AppState>(() => ({
  todos: [
    { id: 1, text: "Learn Supergrain", completed: false },
    { id: 2, text: "Build something", completed: false },
  ],
  selected: null,
}));
```

**Step 2: Mount the Provider at the root.** Each mount builds a fresh store, so SSR requests and tests are isolated by construction.

```tsx
// main.tsx
import { Provider } from "./store";
import { App } from "./App";

<Provider>
  <App />
</Provider>;
```

**Step 3: Read the store from any descendant via `useStore()`.**

```tsx
// TodoItem.tsx
import { tracked, useComputed } from "@supergrain/react";
import { useStore, type Todo } from "./store";

export const TodoItem = tracked(({ todo }: { todo: Todo }) => {
  const store = useStore();
  const isSelected = useComputed(() => store.selected === todo.id);

  return (
    <li className={isSelected ? "selected" : ""}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={() => (todo.completed = !todo.completed)}
      />
      {todo.text}
    </li>
  );
});
```

**Step 4: Use `useComputed` for derived values, `useSignalEffect` for side effects.**

```tsx
// App.tsx
import { tracked, useComputed, useSignalEffect, For } from "@supergrain/react";
import { useStore } from "./store";
import { TodoItem } from "./TodoItem";

export const App = tracked(() => {
  const store = useStore();
  const remaining = useComputed(() => store.todos.filter((t) => !t.completed).length);

  useSignalEffect(() => {
    const count = store.todos.filter((t) => !t.completed).length;
    document.title = `${count} items left`;
  });

  return (
    <div>
      <h1>Todos ({remaining})</h1>
      <For each={store.todos}>{(todo) => <TodoItem key={todo.id} todo={todo} />}</For>
    </div>
  );
});
```

Checking a todo re-renders only that `TodoItem`. Changing selection re-renders only the 2 affected items. The `App` component and other items don't re-render.

## API

### Core

From `@supergrain/core`. Framework-agnostic primitives.

`createReactive<T>(initial)`

Creates a reactive proxy. Reads and writes work like plain objects. The primitive — use directly for standalone state, or wrap it with the React helpers below.

### React

From `@supergrain/react`. React-specific hooks and components.

`useReactive<T>(initial)`

Per-component reactive state. Creates the proxy once on mount; the identity stays stable across renders. Use for state scoped to a single component — no Provider needed.

`createStore<T>(() => initial)`

Returns `{ Provider, useStore }` for app-wide or subtree-wide state. The Provider creates a fresh store on mount (each request/test gets its own), and `useStore()` reads it from context. The proxy's identity never changes, so the context value is stable and won't trigger React re-renders.

`tracked(Component)`

Wraps a React component with per-component signal scoping. Only the signals read during render are tracked — when they change, only this component re-renders.

`useComputed(() => expr, deps?)`

Shorthand for `useMemo(() => computed(factory), deps)`. Re-evaluates when upstream signals change, but only triggers a re-render when the **result** changes — acting as a firewall. The `deps` array works exactly like `useMemo`: when deps change, a new computed is created.

`useSignalEffect(() => sideEffect)`

Shorthand for `useEffect(() => effect(fn), [])`. Runs a signal-tracked side effect that re-runs when tracked signals change and cleans up on unmount. Does **not** cause the component to re-render.

`<For each={array} parent={ref?}>{item => ...}</For>`

Optimized list rendering. Tracks which items actually changed and only re-renders those. When a `parent` ref is provided, swaps use O(1) direct DOM moves instead of O(n) React reconciliation.

See how Supergrain compares to useState, Zustand, Redux, and MobX in the [comparison guide](./comparison).

## Features

### Ergonomic

Signal-level performance with a proxy experience. No new mental model — if you know JavaScript objects, you know Supergrain.

```ts
const store = createReactive({ count: 0, user: { name: "Jane" } });

// Read like a plain object
console.log(store.count); // 0
console.log(store.user.name); // 'Jane'

// Write like a plain object
store.count = 5;
store.user.name = "Alice";
```

- No actions, reducers, selectors, or dispatch
- No `set()` wrappers or updater functions
- Full TypeScript inference — no manual type annotations on reads or writes

### Mutation

Arrays and objects work exactly how you'd expect. Push, splice, assign, delete — all tracked, all reactive.

```ts
const store = createReactive({
  items: ["a", "b", "c"],
  user: { name: "Jane", age: 30 },
});

// Arrays
store.items.push("d");
store.items.splice(1, 1);
store.items[0] = "x";

// Objects
store.user.name = "Alice";
delete store.user.age;
```

- Every mutation fires reactive updates automatically
- No immutable spreading, no immer, no copy-on-write
- Writes are synchronous — read your own writes immediately

### Deep Reactivity

Nested objects and arrays are reactive at any depth. No `observable()` calls, no `ref()` wrappers — the entire tree is tracked automatically.

```ts
const store = createReactive({
  org: {
    teams: [{ name: "Frontend", members: [{ name: "Alice", active: true }] }],
  },
});

// Change a deeply nested property
store.org.teams[0].members[0].active = false;

// Only components reading `active` on that specific member re-render
```

- Works at any nesting depth — objects, arrays, arrays of objects
- No manual wrapping or opt-in per field
- Proxy-based: new properties and nested objects are automatically reactive

### Performance

Fine-grained means what _doesn't_ re-render matters most. When one property changes, only the components that actually read that property update.

```tsx
const store = createReactive({ count: 0, theme: "light" });

// Only re-renders when `count` changes — not when `theme` changes
const Counter = tracked(() => <p>{store.count}</p>);

// Only re-renders when `theme` changes — not when `count` changes
const Theme = tracked(() => <p>{store.theme}</p>);
```

- Per-component signal scoping via `tracked()`
- Sibling components are independent — no wasted renders
- Parent components don't re-render when children's data changes

### Computed

Derived values that act as a firewall. `useComputed` re-evaluates when upstream signals change, but only triggers a re-render when the **result** changes.

```tsx
const store = createReactive({
  selected: 3,
  todos: [
    /* 1000 items */
  ],
});

const TodoItem = tracked(({ todo }) => {
  // Only re-renders when this specific item's selection state flips
  const isSelected = useComputed(() => store.selected === todo.id);
  return <li className={isSelected ? "active" : ""}>{todo.text}</li>;
});
```

- 998 rows return `false` → they don't re-render when selection changes
- Only the 2 rows whose result flips (`true↔false`) update
- Shorthand for `useMemo(() => computed(factory), deps)`

### Effects

Signal-tracked side effects that run outside the React render cycle. They re-run when tracked signals change, but never cause the component to re-render.

```tsx
const App = tracked(() => {
  const store = Store.useStore();
  const remaining = useComputed(() => store.todos.filter((t) => !t.completed).length);

  useSignalEffect(() => {
    document.title = `${remaining} items left`;
  });

  return <TodoList />;
});
```

- Runs immediately, re-runs when tracked signals change
- Cleans up automatically on unmount
- Shorthand for `useEffect(() => effect(fn), [])`

### Looping

`<For>` renders lists with per-item tracking. Only items that actually changed re-render — not the entire list.

```tsx
const App = tracked(() => {
  const store = Store.useStore();

  return (
    <For each={store.todos} parent={tableRef}>
      {(todo) => <TodoItem key={todo.id} todo={todo} />}
    </For>
  );
});
```

- Tracks which items changed and only re-renders those
- Optional `parent` ref enables O(1) direct DOM moves for swaps
- Without `parent`, falls back to standard React reconciliation

### Synchronous Writes and Batching

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

<!-- ## Benchmarks

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

Supergrain delivers fine-grained reactivity with per-component signal scoping at no meaningful performance cost compared to plain React hooks — while providing a dramatically simpler API than Zustand or Redux. -->

## Update Operators (Optional)

For complex updates — batched mutations, array manipulations, dot-notation paths — import `update` and pass the store as the first argument:

```typescript
// [#DOC_TEST_46](packages/doc-tests/tests/readme-core.test.ts)

import { createReactive, update } from "@supergrain/core";

const store = createReactive({
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
