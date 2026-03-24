# Benchmark Optimization Plan

Goal: close the ~14% gap vs react-hooks on create 1k (46.6ms → 40.8ms target).

## Baseline Data (unminified React dev build for readable names)

Heap snapshot diff for create 1k rows shows **+333k objects, +9.2 MB** (dev build; production is ~+244k objects, +6.8 MB):

| Per Row | Constructor | Size (dev) | What |
|---------|-------------|------------|------|
| 88.9 | Object | 2,288 KB | Props, hook state, fiber metadata, signal nodes |
| 81.0 | InternalNode | 0 KB | Native DOM/React wrappers |
| 40.0 | heap number | 469 KB | Dev-only boxed numbers (ignore) |
| **10.0** | **FiberNode** | **1,406 KB** | **React fiber nodes — #1 allocation by size** |
| 10.0 | Error | 234 KB | Dev-only stack traces (ignore) |
| 11.0 | closure | 309 KB | Anonymous closures (tracked internals, handlers) |
| 10.0 | system/Context | 234 KB | V8 closure variable contexts |
| 7.0 | native_bind | 164 KB | .bind() calls |
| 8.0 | Array | 125 KB | Hook state arrays |
| 2.0 | subscribe | 55 KB | tracked() useSyncExternalStore subscribe fns |
| 2.0 | getSnapshot | 55 KB | tracked() useSyncExternalStore snapshot fns |
| 2.0 | onClick | 55 KB | Click handlers |

**Key finding**: 10 FiberNodes per row × 1000 rows = 1.4 MB just for React's fiber tree.
With 3 components/row (For slot + CachedForItem + Row) and 10+ hooks/row, each gets a fiber + hook linked list nodes.

react-hooks has **1 component, 0 hooks per row**. We have **3 components, 10+ hooks per row**.

## Investigation & Optimization Steps

Each step below should be done in order. **Measure before AND after each change** using `pnpm test:heap` and `pnpm test:perf`.

---

### Step 1: Identify the 10 FiberNode objects per row ✅ DONE

**Answer**: The 10,000 `Kv` objects from the minified build are **React FiberNodes** (confirmed via unminified React dev build). 10 FiberNodes per row = **1.4 MB total**, the single largest allocation type by size.

Each `tracked()` component gets 1 fiber + hook state nodes. With 3 components/row and 10+ hooks, ~10 fibers/row is expected. Eliminating one component layer directly reduces fiber count.

---

### Step 2: Merge CachedForItem into Row (eliminate 1 tracked() layer) ❌ BLOCKED

**Theory**: CachedForItem exists to cache the item ref for O(1) DOM swaps. But it's wrapped in `tracked()`, which adds per-row: 1 useRef, 1 useSyncExternalStore, 1 useEffect, 1 alien-signals effect, 2 closures (subscribe + getSnapshot), plus a full React component mount.

CachedForItem's actual logic is just 2 useRefs and an index-change check. This could be done inside Row itself or via a lighter wrapper that doesn't need its own reactive tracking.

**How to investigate**:
- CachedForItem is tracked so it can subscribe to array structural changes. But does it actually need its own effect? The `For` component already subscribes to `$TRACK` for structural changes.
- If CachedForItem is only rendering its children (the Row), and the Row is itself tracked, the CachedForItem `tracked()` wrapper may be doing nothing useful.

**How to validate**:
1. Create a `LiteCachedForItem` that does the caching logic (2 useRefs + index check) but is NOT wrapped in `tracked()` — just a plain `memo()` component.
2. Run `pnpm test` (correctness) — does swap still work?
3. Run `pnpm test:heap` — expect -1000 effects, -2000 closures (subscribe/getSnapshot), -1000 useEffect cleanups.
4. Run `pnpm test:perf` — measure timing delta.

**Expected savings**: ~5 hooks/row, ~1 effect/row, ~3 closures/row, ~40 InternalNodes/row.

**RESULT**: ❌ Cannot do this. CachedForItem MUST use tracked() because children callbacks
can read reactive properties inline (e.g., `item.label`). Those reads happen during
CachedForItem's render and need an active alien-signals subscriber. Replacing tracked()
with memo() causes "swap then update label" tests to fail. See code comment on CachedForItem.

When children are wrapped in tracked() (like the benchmark's Row), CachedForItem's tracked()
effect has zero dependencies — but the For API must support inline children too.

**Alternative approaches to explore**:
- A specialized `trackedForItem` that merges CachedForItem's caching + tracked()'s
  reactivity into a single component with fewer total hooks
- Having the benchmark's Row component handle its own item caching (benchmark-only opt)
- A completely different O(1) swap mechanism that doesn't need a wrapper component

---

### Step 3: Eliminate useComputed in Row for selected state

**Theory**: `useComputed(() => store.selected === item.id)` creates a computed signal node per row. On create, no row is selected, so this computed is wasted work. The computed also goes through the proxy trap twice (store.selected + item.id).

**How to investigate**:
- Can selected state be compared via a simple equality check instead of a computed signal?
- The Row is already inside a `tracked()` wrapper that captures reactive reads. If Row reads `store.selected` directly, changes to `selected` would re-render ALL rows (since every row depends on it).
- The computed acts as a filter: it only re-renders the row when `store.selected === item.id` changes from true↔false.
- **This is actually necessary for correctness** — without it, selecting a row would re-render all 1000 rows.

**Alternative approaches**:
- A: Move selected into per-item state (`item.selected` boolean). Then each row only reads its own item. But this changes the store API.
- B: Keep the computed but lazily create it (don't create until first access? But it's always accessed on render).
- C: Use a lighter mechanism than `computed()` — a simple memoized comparison that doesn't create a signal graph node.

**How to validate**: Measure computed signal cost in isolation. If it's small (<5% of per-row cost), skip this and focus elsewhere.

---

### Step 4: Reduce closures in tracked()

**Theory**: Each `tracked()` creates subscribe, getSnapshot, and cleanup closures. That's 3 closures × 2 tracked components/row (or 1 if Step 2 succeeds) = 3-6 closures/row.

**How to investigate**:
- Can subscribe and getSnapshot be methods on the ref object instead of closures? V8 shares method code across instances.
- The subscribe/getSnapshot closures capture `listener` and `version` via closure scope. These could instead be properties on the ref object.

**How to validate**:
1. Refactor tracked() to use ref.current properties instead of closure variables
2. Run heap test — expect ~2-4 fewer closures per row
3. Run correctness tests
4. Run perf test

---

### Step 5: Reduce For component overhead

**Theory**: For creates these per-render:
- `Array.from({ length: 1000 })` — 1 array + 1000 slots
- `[...raw]` — 1000-element copy for swap detection
- 1000 `React.createElement(CachedForItem, ...)` calls with props objects

**How to investigate**:
- Can `Array.from` be replaced with a pre-allocated array or direct JSX array?
- The `[...raw]` copy: is it needed on initial create? No swaps have happened yet.
- Can the element creation be cheaper?

**How to validate**: Profile For's render time in isolation. If < 2ms, skip.

---

### Step 6: Profile against react-hooks directly

**Final validation**: After making changes, run both implementations through the same Playwright perf harness and compare head-to-head.

**How**: Set up the react-hooks benchmark as a second page in the test server, run identical measurements, output comparison table.

---

## Prioritization

| Step | Expected Impact | Effort | Risk |
|------|----------------|--------|------|
| 2 (merge CachedForItem) | HIGH — eliminates ~50% of per-row hook overhead | Medium | Medium — swap correctness |
| 4 (reduce closures) | MEDIUM — fewer allocations per tracked() | Low | Low |
| 1 (identify Kv) | DATA — informs other decisions | Low | None |
| 3 (useComputed) | LOW-MEDIUM — 1 signal node/row | Medium | High — correctness |
| 5 (For overhead) | LOW — one-time cost, not per-row | Low | Low |
| 6 (head-to-head) | VALIDATION | Medium | None |

**Recommended order**: 1 → 2 → 4 → 5 → 3 → 6
