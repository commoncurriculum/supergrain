# @supergrain/kernel

A fast, ergonomic reactive store for React.

- **Plain objects** — read properties, assign values, push to arrays. No special syntax.
- **Fine-grained** — only the components that read changed properties re-render
- **Synchronous** — state updates are immediate, not deferred to the next render
- **Type-safe** — full TypeScript inference on stores and mutations
- **Zero boilerplate** — no actions, reducers, or selectors

## Install

```bash
pnpm add @supergrain/kernel
```

The React subpath (`@supergrain/kernel/react`) ships in the same package and requires `react >= 18.2`.

## Quick Start

Supergrain has two APIs for state. Use `useReactive` for state that lives inside a single component. Use `createStoreContext` for state shared across your app.

### Local state — `useReactive`

For state scoped to a single component, `useReactive` returns a reactive proxy that lives for the component's lifetime. No Provider, no setup — mutate it like a plain object.

```tsx
// [#DOC_TEST_LOCAL_STATE](../doc-tests/tests/readme-react.test.tsx)

import { tracked, useReactive } from "@supergrain/kernel/react";

const Counter = tracked(() => {
  const state = useReactive({ count: 0 });
  return <button onClick={() => state.count++}>Clicked {state.count} times</button>;
});
```

Wrap the component in `tracked()` to get fine-grained re-renders: only the properties you read are tracked.

### App-wide state — `createStoreContext`

For state shared across components, call `createStoreContext<T>()` once at module scope and destructure `{ Provider, useStore }`. The Provider takes an `initial` prop; it constructs a reactive store from that data exactly once per mount, so every SSR request, every test, and every React tree gets an isolated store by construction.

**Step 1: Describe the shape and call the factory.**

```tsx
// [#DOC_TEST_QUICK_START](../doc-tests/tests/readme-react.test.tsx)
// store.ts
import { createStoreContext } from "@supergrain/kernel/react";

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
}
export interface AppState {
  todos: Todo[];
  selected: number | null;
}

export const { Provider, useStore } = createStoreContext<AppState>();
```

**Step 2: Mount the Provider at the root.** Pass the initial data; the Provider wraps it in `createReactive` per-mount, so SSR and tests are isolated automatically.

```tsx
// main.tsx
import { Provider } from "./store";
import { App } from "./App";

<Provider
  initial={{
    todos: [
      { id: 1, text: "Learn Supergrain", completed: false },
      { id: 2, text: "Build something", completed: false },
    ],
    selected: null,
  }}
>
  <App />
</Provider>;
```

**Step 3: Read the store from any descendant via `useStore()`.**

```tsx
// TodoItem.tsx
import { tracked, useComputed } from "@supergrain/kernel/react";
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
import { tracked, useComputed, useSignalEffect, For } from "@supergrain/kernel/react";
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

From `@supergrain/kernel`. Framework-agnostic primitives.

- `createReactive<T>(initial)`

  > Returns a reactive proxy you can read from and mutate directly. Use it for standalone reactive state outside React, or pair it with the React helpers below to drive component renders.

- `computed(fn)`

  > Returns a derived value that recomputes lazily when its dependencies change. Use for memoized derivations outside React (`useComputed` is the React-aware variant).

- `effect(fn)`

  > Runs `fn` immediately and re-runs it whenever its dependencies change. Returns a stop function. Use outside React; for components, prefer `useSignalEffect`.

- `batch(fn)`

  > Coalesces signal writes inside `fn` into a single notification. Throws if `fn` returns a Promise (must be sync).

- `resource<T>(initial, setup)`

  > Reactive value produced by a setup function with cleanup. Setup runs on create, reruns on tracked signal change (cleanup first), and exposes an `AbortSignal` that aborts on rerun/dispose. Sync or async. Use for timers, observers, subscriptions, media queries — anything where you'd otherwise hand-roll a `useState` + `useEffect` + `useRef` triple.

- `reactivePromise<T>(asyncFn)`

  > Ergonomic async envelope on top of `resource`. Same lifecycle (re-runs on tracked signal change, aborts previous), plus `{ value, error, isPending, isResolved, isRejected, isSettled, isReady }` and a thenable for `await`.

- `reactiveTask<Args, T>(asyncFn)`
  > Imperative async command. Same state fields as `reactivePromise`, but doesn't auto-run — call `.run(...args)` to trigger. Use for user-initiated mutations (save, submit) where you want loading/error state without tracking inputs.

### React

From `@supergrain/kernel/react`. React-specific hooks and components.

- `useReactive<T>(initial)`

  > Per-component reactive state. Creates the proxy once on mount; the identity stays stable across renders. Use for state scoped to a single component — no Provider needed.

- `createStoreContext<T>()`

  > Returns `{ Provider, useStore }` bound to a fresh React Context. Call once at module scope, destructure, re-export. The Provider takes an `initial: T` prop and wraps it in `createReactive()` once per mount — SSR requests and tests are isolated by construction. Each factory call mints a distinct Context, so two sibling Providers coexist without collision.

- `tracked(Component)`

  > Wraps a React component with per-component signal scoping. Only the signals read during render are tracked — when they change, only this component re-renders.

- `useComputed(() => expr, deps?)`

  > Shorthand for `useMemo(() => computed(factory), deps)`. Re-evaluates when upstream signals change, but only triggers a re-render when the **result** changes — acting as a firewall. The `deps` array works exactly like `useMemo`: when deps change, a new computed is created.

- `useSignalEffect(() => sideEffect)`

  > Shorthand for `useEffect(() => effect(fn), [])`. Runs a signal-tracked side effect that re-runs when tracked signals change and cleans up on unmount. Does **not** cause the component to re-render.

- `useResource<T>(initial, setup, deps?)`

  > Component-scoped `resource`. Disposes on unmount (aborts in-flight work, runs cleanups) and rebuilds when `deps` change.

- `useReactivePromise<T>(asyncFn, deps?)`

  > Component-scoped `reactivePromise`. Same shape, auto-disposed on unmount.

- `useReactiveTask<Args, T>(asyncFn, deps?)`

  > Component-scoped `reactiveTask`. Identity is stable across renders when `deps` don't change — safe to pass to children or into effect deps.

- `modifier<E, Args>(fn)` + `useModifier(m, ...args)`

  > Reusable setup/teardown attached to a DOM element via `ref`. `modifier` defines the behavior (returns cleanup like `useEffect`); `useModifier` binds it to a component and produces a stable ref callback. Args flow through an internal ref so a fresh handler per render doesn't re-attach. Signals read inside setup trigger a targeted teardown+re-setup on change without re-rendering the component.

- `<For each={array} parent={ref?}>{item => ...}</For>`
  > Optimized list rendering. Tracks which items actually changed and only re-renders those. When a `parent` ref is provided, swaps use O(1) direct DOM moves instead of O(n) React reconciliation.

See how Supergrain compares to useState, Zustand, Redux, and MobX in the [comparison guide](https://github.com/commoncurriculum/supergrain/blob/main/docs/comparison.md).

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

Single mutations are always safe. When you need to make **multiple mutations atomically**, wrap them in `batch()`. Without batching, each write fires reactive effects immediately — a `computed` that reads both swapped positions would run mid-swap and see a duplicate:

```ts
// ❌ Without batching — computed sees [C, B, C] after first write
const tmp = store.data[0];
store.data[0] = store.data[2]; // effects fire — data is [C, B, C]
store.data[2] = tmp; // effects fire again — data is [C, B, A]
```

Wrap multi-step mutations in `batch()` so effects fire once with the final state:

```ts
import { batch } from "@supergrain/kernel";

batch(() => {
  const tmp = store.data[0];
  store.data[0] = store.data[2];
  store.data[2] = tmp;
}); // effects fire once — data is [C, B, A]
```

## How it works

Supergrain wraps your state in a JavaScript [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy). Plain objects and arrays are wrapped recursively; reading a property creates a signal on demand and subscribes the currently-running effect to it. Writing a property notifies that signal's subscribers. There's no upfront analysis of your state shape — the reactive graph is built lazily as your code touches properties.

Signal propagation is handled by [alien-signals](https://github.com/stackblitz/alien-signals), the same primitive used by Vue Vapor and a handful of other modern reactive runtimes. It gives Supergrain push-based updates with topological ordering and glitch-free `computed` chains, without any manual scheduling.

`tracked()` is the bridge into React. Each `tracked` component runs its render inside its own signal-tracking scope, so the only signals it subscribes to are the ones it actually read this render. When one of those signals changes, only that component re-renders — never its parent, never its siblings. This is the per-component signal scoping that makes fine-grained reactivity possible in React's top-down model.

For SSR, `Provider` runs its initializer once per mount, which means each request gets its own fresh store instance. Reactive reads work on the server (no DOM dependencies) and the proxy survives serialization-equivalent traversal, so you can read state during render without special handling. Tests are isolated for the same reason: each `<Provider>` creates an independent store.

React features that trip up many state libraries — concurrent rendering, Suspense boundaries, the [zombie-child problem](https://github.com/reduxjs/react-redux/issues/1177) — work here because reads are synchronous and per-component. There's no shared subscription that gets stale between renders, no torn-state window between commit and effect, and no `useSyncExternalStore` snapshot that has to be diffed across renders.

## FAQ

<details>
<summary><strong>Why isn't my class instance / <code>Map</code> / <code>Set</code> reactive?</strong></summary>

Supergrain only proxies plain objects (`Object` constructor) and arrays. Class instances, `Map`, `Set`, `Date`, `RegExp`, and other built-ins pass through unchanged — they won't trigger re-renders when mutated. Store plain JSON-like data in your store; keep class instances and collections outside it. We may add `Map`/`Set` support in a later release.

</details>

<details>
<summary><strong>Can I use <code>batch()</code> with <code>await</code>?</strong></summary>

No. `batch()` callbacks must be synchronous. The underlying `batchDepth` counter is global, so awaiting inside a batch would (a) silently lump every other write happening anywhere in the app into your batch, and (b) leave the depth elevated forever if the awaited promise rejects. The wrapper throws if your callback returns a Promise to make this explicit.

</details>

<details>
<summary><strong>How does <code>tracked()</code> interact with <code>React.memo</code>?</strong></summary>

`tracked()` automatically wraps your component in `React.memo` (shallow prop equality), so a tracked component skips re-renders when its parent re-renders with the same prop references. The usual `memo` gotchas apply — passing a fresh inline object, array, or closure as a prop will defeat the equality check and cause re-renders even when the underlying data is unchanged.

</details>

<details>
<summary><strong>How deep does dot-notation path typing go?</strong></summary>

Path autocompletion and type checking work up to 5 levels of nesting. Beyond that, paths fall through to a permissive `Record<string, unknown>` type. This limit exists because TypeScript's conditional-type recursion gets very expensive past depth 5; raising it would significantly slow type-checking for downstream consumers.

</details>

<details>
<summary><strong>How does this compare to other signal-based React libraries?</strong></summary>

See the [Comparison Guide](https://github.com/commoncurriculum/supergrain/blob/main/docs/comparison.md). Briefly: most signal libraries (Preact Signals, MobX, Jotai) require you to wrap individual values in signal/atom containers. Supergrain wraps a _whole object tree_ in a Proxy, so you write plain `store.user.name = "x"` and reads/writes are tracked automatically. Internally we use alien-signals for propagation, and `tracked()` gives per-component subscription scoping — closer in spirit to Solid's reactive components than to React Compiler's auto-memoization.

</details>

<details>
<summary><strong>Is there a way to react to <em>any</em> change inside an object without subscribing to every key individually?</strong></summary>

Not currently, and not planned. Subscriptions are per-signal — reading a property subscribes you to that property's signal, and that's the granularity. To react to a deep change like `a.b.c = 1`, something has to read `a.b.c` (or a computed derived from it) inside the effect.

If you need to observe a whole subtree, the practical patterns are: derive what you actually care about with `useComputed`, or read each leaf you depend on inside an `effect`/`useSignalEffect`.

</details>

## License

MIT
