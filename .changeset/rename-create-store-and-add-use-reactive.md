---
"@supergrain/core": major
"@supergrain/react": major
"@supergrain/store": major
---

Rename the `createStore` primitive in `@supergrain/core` to `createReactive`, and reshape the React integration.

**Breaking changes:**

- `@supergrain/core`: `createStore` is renamed to `createReactive`. Same behavior, clearer vocabulary — the primitive builds a reactive proxy; the word "store" is reserved for the app-wide API in `@supergrain/react`.
- `@supergrain/react`: `provideStore(store)` is removed. Replace with the new `createStore(() => initial)` factory, which takes an initializer function and returns `{ Provider, useStore }`. The Provider creates a fresh store on each mount, so SSR and tests are isolated by construction.

**New:**

- `@supergrain/react` ships `useReactive(initial)` for per-component reactive state. No Provider needed for state scoped to a single component.

**Migration:**

```ts
// Before
import { createStore } from "@supergrain/core";
import { provideStore } from "@supergrain/react";

const store = createStore<AppState>({ ... });
const Store = provideStore(store);
// <Store.Provider>, Store.useStore()

// After
import { createStore } from "@supergrain/react";

const { Provider, useStore } = createStore<AppState>(() => ({ ... }));
// <Provider>, useStore()
```

For per-component state:

```tsx
// Before: needed useMemo + createStore
// After:
import { useReactive } from "@supergrain/react";

function Counter() {
  const state = useReactive({ count: 0 });
  return <button onClick={() => state.count++}>{state.count}</button>;
}
```
