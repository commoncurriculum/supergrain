# Direct DOM Bypass

Three attempts were made to bypass React's reconciler by wiring alien-signals effects directly to DOM nodes, skipping VDOM diffing entirely. All three were removed.

## Approach 1: `$$()` compiler transform

_Removed: commit `db6c8dc`, 2026-03-18_

A Vite plugin (`@supergrain/vite-plugin`) rewrote JSX expressions marked with `$$()` into direct signal-to-DOM bindings:

```tsx
// Author writes:
<a>{$$(item.label)}</a>
<tr className={$$(() => selected === item.id ? 'danger' : '')}>

// Compiler output wires:
//   effect(() => { aRef.current.textContent = item.label() })
//   effect(() => { trRef.current.className = ... })
```

Also included `DirectFor`, a list component that used `cloneNode` + signal effects instead of React components for rows.

**What was deleted**: `packages/vite-plugin/`, `packages/js-krauset-direct/`, `packages/react-example/`, plus `useDirectBindings`, `DirectFor`, and `createView` from `packages/react` and `packages/core`.

**Why it failed**:

- Structural updates (add/remove/reorder rows) require either full DOM rebuilds or reimplementing React's keyed reconciliation. `DirectFor` did full rebuilds — "catastrophic on mutations."
- Compiler complexity: every bundler needs a plugin, compiled output is hard to debug.
- No SSR. `cloneNode` and imperative DOM manipulation have no server rendering path.

## Approach 2: Internal benchmark `DirectDomApp`

_Removed: 2026-03-22_

A benchmark component using `@supergrain/core/internal` APIs (`$NODE`, `$RAW`) to manually wire signals to DOM nodes. Used to measure the theoretical performance ceiling of signal-to-DOM without React. Also included Solid-js benchmark variants for comparison.

**What was deleted**: `packages/react/benchmarks/direct-dom.bench.tsx`, `gap-analysis.bench.tsx`, `gap-detail.bench.tsx`, and the Direct DOM / Solid-js sections from `benchmark-correctness.test.tsx`.

**Why it was removed**:

- No SSR — same fundamental blocker.
- Not a real API — depended on internal symbols.
- Benchmark numbers were unreliable. The `act()` wrapper inflated React's overhead, making the gap appear larger than in real-world usage. The numbers were not trustworthy enough to inform decisions.

## Approach 3: `bind()` ref callbacks

_Tested and rejected: 2026-03-22_

React 19 ref callbacks with cleanup, wiring signal effects to DOM nodes:

```tsx
function bind(fn: () => any): React.RefCallback<HTMLElement> {
  return (el) => {
    if (!el) return;
    return effect(() => {
      el.textContent = String(fn());
    });
  };
}

<td ref={bind(() => item.label)} />;
```

**Why it failed**:

- Not faster than `tracked()`. The per-ref effect setup overhead exceeds the savings from skipping React's trivial single-text-node diff. (Benchmarked in the same `act()`-afflicted harness, so exact numbers are not reliable, but the relative comparison showed bind was not faster.)
- Requires `() =>` wrapper on every reactive expression — easy to forget, no error when forgotten.
- Only handles `textContent` and attributes via ref, not arbitrary children.
- No SSR — refs don't exist on the server.

## The fundamental problem

All three approaches hit the same wall: **JavaScript evaluates arguments before passing them.** `item.label` reads the signal at the call site, not inside the receiving component. Deferring that read requires either a function wrapper (`() =>`), a compiler, or a proxy returning special lazy objects (which would break comparisons and arithmetic). And even with deferred reads, none of these approaches support SSR.

## Why `tracked()` + `For` is sufficient

- `tracked()` scopes signal subscriptions per-component. When `item.label` changes, only that Row re-renders — not the parent, not siblings.
- React's diff of a single `<tr>` with one changed text node is trivially cheap.
- Full SSR support out of the box.
- No compiler, no special syntax, no footguns.
