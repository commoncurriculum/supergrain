# Direct DOM Analysis: Bypassing React's VDOM for Signal-Driven Updates

## Context

Supergrain's `tracked()` wrapper bridges alien-signals to React: an effect subscribes to signals read during render, then calls `forceUpdate()` when they change. React re-renders the component, diffs the VDOM, and patches the real DOM. This works correctly but pays the full React overhead on every signal change.

The `$$()` API was a previous attempt at a direct-dom approach — it was removed in commit `db6c8dc` because of diffing problems. The internal benchmarks still measure the theoretical ceiling of signal-to-DOM without React.

## Current Benchmark Numbers (proxy vs direct-dom)

| Operation        | proxy (hz) | direct-dom (hz) | Speedup |
| ---------------- | ---------- | --------------- | ------- |
| Create 1000 rows | 1.5        | 32.3            | 21x     |
| Select row       | 12         | 130             | 11x     |
| Swap rows        | 2.2        | 69              | 31x     |
| Partial update   | 16.3       | 106             | 6x      |

The gap is enormous — 6-31x. This is the cost of React's reconciliation on every signal change.

## How the Current Direct-DOM Benchmark Works

Located in `packages/react/benchmarks/direct-dom.bench.tsx`, the `DirectDomApp` component:

1. Uses React only for the outer shell (`<table><tbody ref={tbodyRef} />`)
2. Builds rows via `document.createElement("tr").cloneNode(true)` — no React components
3. Wires alien-signals effects directly to DOM text nodes:
   ```ts
   effect(() => {
     a1.textContent = itemNodes.label(); // signal read → DOM write
   });
   effect(() => {
     tr.className = storeNodes.selected() === itemId ? "danger" : "";
   });
   ```
4. Accesses internal symbols (`$NODE`, `$RAW` from `@supergrain/core/internal`) to read signal nodes directly

This is fast because each signal change does exactly one DOM mutation — no VDOM diff, no reconciliation, no component tree traversal.

## Why $$() Was Removed

The `$$()` approach tried to be general-purpose: it would compile JSX expressions into direct-dom bindings. The problem was structural updates (adding/removing children, reordering). When a signal change requires adding a new `<tr>` or removing one, you need either:

- A full rebuild of the parent (what `DirectFor` did — "catastrophic on mutations" per the removal commit)
- A diffing algorithm to reconcile the old and new children (reimplementing React's reconciler)

Neither worked well. Full rebuilds destroyed performance on mutations. Diffing reimplemented React poorly.

## The Leaf-Node Insight

The direct-dom approach works perfectly when scoped to **leaf updates** — changes that affect a single text node or a single element's attribute, not structural changes. Looking at the benchmark:

- **Label update**: `a1.textContent = signal()` — one signal, one text node. Perfect.
- **Selection class**: `tr.className = signal() === id ? "danger" : ""` — one signal, one attribute. Perfect.
- **Row creation/removal**: needs structural DOM changes. This is where it breaks.

The key realization: **if you let React handle structure (adding/removing/reordering elements via `<For>` and keys) and only use direct-dom for leaf text/attribute updates within those elements, you get the best of both worlds.**

## Architecture for a Scoped Direct-DOM Approach

### What React handles (structural):

- Component mounting/unmounting
- List reconciliation (keyed children via `<For>`)
- Conditional rendering (`{show && <Component />}`)

### What direct-dom handles (leaf):

- Text content: `<td>{store.name}</td>` → effect wires `signal → textNode.textContent`
- Attributes: `className={store.selected === id ? "danger" : ""}` → effect wires `signal → element.className`
- Style properties: `style={{ color: store.color }}` → effect wires `signal → element.style.color`

### What this means concretely:

Instead of:

```tsx
// Current: React re-renders entire Row component when label changes
const Row = tracked(({ item }) => (
  <tr>
    <td>{item.id}</td>
    <td>
      <a>{item.label}</a>
    </td>{" "}
    {/* label change → full Row re-render → VDOM diff */}
  </tr>
));
```

The direct-dom approach would:

```tsx
// Hypothetical: React renders the structure once, signals update text directly
const Row = ({ item }) => {
  const labelRef = useRef<Text>(null);

  // One effect per leaf binding — fires when item.label signal changes
  useSignalBinding(labelRef, () => item.label);

  return (
    <tr>
      <td>{item.id}</td> {/* static — never changes */}
      <td>
        <a>
          <TextNode ref={labelRef} />
        </a>
      </td>{" "}
      {/* direct signal → text node */}
    </tr>
  );
};
```

## Key Technical Questions for Investigation

1. **React.createRoot vs direct text node manipulation**: Can we create a React component that renders a text node and then update that text node directly without React knowing? React 19's reconciler might detect the mutation and fight it on the next render.

2. **Ref-based approach**: If a component renders `<span ref={ref}>{initialValue}</span>` and an effect updates `ref.current.textContent`, does React's reconciler overwrite it on parent re-renders? The answer depends on whether the parent re-renders at all — if the parent is `memo`'d and its props don't change, the child DOM stays untouched.

3. **Hybrid tracked + direct**: Could `tracked()` be modified so that signal reads in "leaf position" (inside text content or attribute expressions) automatically wire up direct-dom effects instead of subscribing the whole component? This would be a compile-time transform.

4. **Compile-time detection of leaf vs structural**: A compiler plugin could analyze JSX and determine:
   - `<td>{store.count}</td>` → leaf text binding (safe for direct-dom)
   - `{store.items.map(i => <Row key={i.id} />)}` → structural (must use React reconciliation)
   - `<tr className={expr}>` → leaf attribute binding (safe for direct-dom)

5. **Escape hatch for manual leaf binding**: Even without a compiler, a userland API like `<Signal>{() => store.label}</Signal>` could render a text node that self-updates via direct-dom, never triggering parent re-renders.

## Existing Code to Reference

- **Benchmark implementation**: `packages/react/benchmarks/direct-dom.bench.tsx` lines 172-215 — the `DirectDomApp` shows the manual wiring pattern
- **Internal API**: `packages/core/src/internal.ts` — exports `$NODE`, `$RAW` for direct signal access
- **Compiled view experiment**: `packages/react/tests/compiled-vs-proxy.test.tsx` — `useCompiled()` and `AppStateView` class show how to bypass the proxy and read signals directly
- **tracked() source**: `packages/react/src/tracked.ts` — the current React bridge that would need modification
- **Removal commit**: `db6c8dc` — full context on what was tried and why it was removed

## Recommendation

The 6-31x performance gap is too large to ignore. The scoped leaf-binding approach avoids the structural diffing problem that killed `$$()`. The investigation should focus on:

1. Whether React allows stable text node / attribute manipulation via refs without interference
2. Whether a `<Signal>` component that self-updates is sufficient (no compiler needed)
3. If a compiler approach is needed, what the transform rules would be (leaf detection)

The goal: React handles structure, signals handle content. Each signal change does O(1) DOM work instead of O(component tree) VDOM work.
