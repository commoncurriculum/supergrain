---
"@supergrain/kernel": major
---

First release of `@supergrain/kernel`. The package was previously published as `@supergrain/core`; the React adapter (formerly `@supergrain/react`) is folded into the new `@supergrain/kernel/react` subpath, so `packages/react/` is gone. Same lineage, new name to match the rest of the rename to `kernel` / `silo` / `mill`.

Also renames the `createStore` primitive to `createReactive` and reshapes the React integration around per-mount construction.

**Breaking changes:**

- `@supergrain/kernel`: `createStore(initial)` is renamed to `createReactive(initial)`. Same behavior, clearer vocabulary — the primitive builds a reactive proxy; the word "store" is reserved for the app-wide APIs in `@supergrain/kernel/react` and `@supergrain/silo`.
- `@supergrain/kernel/react`: `provideStore(store)`, `StoreProvider`, the free-standing `useStore`, and the `StoreRegistry` module-augmentation default singleton are all removed. Replace with `createStoreContext<T>()`, which returns `{ Provider, useStore }` tied to a fresh React Context. Pass your initial state to the Provider via the `initial` prop; the Provider wraps it in `createReactive(...)` exactly once per mount via the `useReactive` hook, so SSR requests, tests, and React trees are isolated by construction. Each factory call mints its own Context — sibling Providers don't collide, and there's no module-level singleton to leak across requests.

**New:**

- `@supergrain/kernel/react` ships `useReactive(initial)` for per-component reactive state. Wraps `createReactive` in `useState` so the proxy lives for the component's lifetime; no Provider needed for state scoped to a single component.

**Migration — package rename:**

```ts
// Before
import { createStore } from "@supergrain/core";
import { tracked } from "@supergrain/react";

// After
import { createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
```

**Migration — app-wide store:**

```tsx
// Before
import { createStore } from "@supergrain/kernel";
import { provideStore } from "@supergrain/kernel/react";

const store = createStore<AppState>({ todos: [], selected: null });
const Store = provideStore(store);

// <Store.Provider><App /></Store.Provider>
// const s = Store.useStore();

// After
import { createStoreContext } from "@supergrain/kernel/react";

export const { Provider, useStore } = createStoreContext<AppState>();

// <Provider initial={{ todos: [], selected: null }}><App /></Provider>
// const s = useStore();
```

**Migration — per-component state:**

```tsx
import { useReactive } from "@supergrain/kernel/react";

function Counter() {
  const state = useReactive({ count: 0 });
  return <button onClick={() => state.count++}>{state.count}</button>;
}
```
