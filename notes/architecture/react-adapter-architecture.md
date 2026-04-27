# React Adapter Architecture

> **Status:** Partially superseded. The core design was implemented in `@supergrain/kernel/react`, but the actual API diverged significantly. The current API uses `tracked()` + `For` + `$$` + `DirectFor`. The earlier `useTracked` hook has been superseded by `tracked()`. See `packages/react/src/` for current implementation.
> **Still valuable:** The design rationale, benchmark findings, and implementation patterns below remain useful reference.

## Goal

Integrate Supergrain's proxy-based reactivity with React without a Babel transform, using `useSyncExternalStore`-style version tracking.

## Key Design Decisions

### Store-centric, not signal-centric

- Users interact with proxied state, not raw signals
- Dependency tracking is automatic via proxies
- Batching is built-in at microtask level

### Version-based subscription pattern

From Preact's signals-react adapter: increment a 32-bit integer version on any tracked signal change, trigger React re-render via `useSyncExternalStore`.

```javascript
trackedEffect._callback = () => {
  version = (version + 1) | 0; // 32-bit integer increment
  if (onChangeNotifyReact) onChangeNotifyReact();
};
```

## Implemented API (actual)

```tsx
// tracked() — returns stable proxy that tracks dependencies per component (formerly useTracked)
const state = tracked(store)

// For — list rendering with automatic version prop injection for memo
<For each={state.items}>
  {(item, index) => <MemoizedRow item={item} />}
</For>

// $$ / useDirectBindings — direct DOM bindings (bypass React reconciliation)
// DirectFor — template-based list rendering
```

## Originally Proposed API (not implemented)

These were designed but not built. Preserved for future reference:

- `useStore(initialState)` — local reactive store (like useState with superpowers)
- `useStoreValue(globalState)` — connect to global store with auto-tracking
- `useDerived(() => ...)` — auto-memoized derived values (no dependency array)
- `useStoreEffect(() => ...)` — reactive side effects
- `useSignalValue(signal)` — raw signal access for performance-critical paths
- `getSignal(state, path)` — extract underlying signal from proxied state

## Implementation Pattern (effect store)

```javascript
function createEffectStore() {
  let version = 0;
  let onChangeNotifyReact = null;

  const trackedEffect = effect(function () {});

  trackedEffect._callback = () => {
    version = (version + 1) | 0;
    if (onChangeNotifyReact) onChangeNotifyReact();
  };

  return {
    subscribe(onStoreChange) {
      onChangeNotifyReact = onStoreChange;
      return () => {
        onChangeNotifyReact = null;
        version++;
      };
    },
    getSnapshot() {
      return version;
    },
    startTracking() {
      /* start alien-signals effect */
    },
    stopTracking() {
      /* dispose effect */
    },
  };
}
```

Note: The actual implementation in `tracked()` (formerly `useTracked`) uses `useReducer` + `effect()` from `@supergrain/kernel` rather than this `useSyncExternalStore` pattern.

## Benchmark Findings

- **ForEach/For provides ~2.4x faster rendering** for large lists (doesn't prevent re-renders, but reduces render work)
- **React's reconciliation is the bottleneck**, not signal access
- **Proxy overhead is acceptable** — 2-15x slower than raw access but still millions of ops/sec
- **Signal extraction valuable** for specific cases, not necessary for most apps

## SSR

Server-side: return non-reactive version (skip effect tracking when `typeof window === 'undefined'`).

## Remaining Checklist

- [x] `tracked()` (formerly `useTracked`) with effect-based tracking
- [x] `For` component for list rendering
- [x] `$$` / `useDirectBindings` for direct DOM bindings
- [x] `DirectFor` for template-based lists
- [ ] `useComputed` / `useDerived` for derived values
- [ ] `useStoreEffect` for reactive side effects
- [ ] `getSignal` utility for raw signal extraction
- [ ] SSR support
- [ ] Development mode warnings
