# Optimization Brainstorm Results

## The bottom line

Supergrain's geometric mean slowdown is **1.98** vs solid-store's 1.00 baseline. react-hooks is at **2.17**. Supergrain already beats react-hooks overall — its swap win (2.37× vs 8.09×) more than compensates for its losses elsewhere.

If supergrain matched react-hooks on every benchmark it currently loses while keeping its swap and replace wins, the geometric mean would improve from **1.98 → 1.89** — a 5% improvement. That's the ceiling from closing the react-hooks gap. The maximum weighted total-time savings at this ceiling is **15.0ms**.

Only **3 benchmarks** have statistically significant total-time losses (verified in both parallel and interleaved measurement rounds): **create-10k**, **append-1k**, and **select**. Everything else — create-1k, replace-1k, partial-update, remove, clear — is tied on total time (p > 0.05).

## Where the ceiling comes from

| Benchmark      | SG total | RH total | Gap      | Significant?                   | Weight |
| -------------- | -------- | -------- | -------- | ------------------------------ | ------ |
| create-10k     | 617.1    | 569.5    | +47.6ms  | p < 0.001 in both rounds       | 0.21   |
| append-1k      | 58.3     | 54.6     | +3.7ms   | p < 0.001 in both rounds       | 0.56   |
| select         | 14.3     | 11.8     | +2.5ms   | p < 0.001 in both rounds       | 0.14   |
| clear          | 58.6     | 53.6     | +5.0ms   | p > 0.10 — **not significant** | 0.42   |
| create-1k      | 51.8     | 51.8     | +0.1ms   | p > 0.10 — **not significant** | 0.64   |
| partial-update | 58.1     | 57.7     | +0.4ms   | p > 0.10 — **not significant** | 1.00   |
| remove         | 45.9     | 45.9     | -0.0ms   | p > 0.10 — **not significant** | 0.48   |
| replace-1k     | 58.8     | 59.6     | -0.8ms   | p > 0.10 — **not significant** | 0.56   |
| swap           | 57.9     | 197.4    | -139.5ms | p < 0.001 — **SG wins**        | 0.28   |

The 5 "not significant" benchmarks have script-time differences that are real (all p < 0.001 on script) but too small to survive paint/layout variance in total time. Reducing script overhead on those benchmarks is real engineering but may not move the benchmark score.

## Methodology

Same machine, same test harness, same CSS, same HTML. Only `src/main.tsx` differs.

- **Parallel**: 15 runs each, ran simultaneously. Risk: resource contention.
- **Interleaved**: 10 runs each, strictly alternating SG→RH→SG→RH. Controls for thermal/OS state.
- **Statistical test**: Welch's t-test, two-tailed, unequal variances. Significant = p < 0.05.
- **CPU profiles**: Single profiling run each via `pnpm perf:profile`. Sampling resolution ~1.3ms. Used for function-level analysis only, not for timing comparisons.
- **Trace files**: Single run each. Used to confirm paint/layout identity between SG and RH.

Script-time deltas reproduced in both rounds for 8 of 9 benchmarks. replace-1k interleaved had an outlier (σ=9.3ms vs normal 0.6ms); the parallel result (SG -1.0ms, p < 0.001) is more reliable.

## What causes the gap

### Measured (from CPU profiles)

These functions appear in supergrain's profiles but are absent in react-hooks:

| Function                                 | What it is                                      | Benchmarks where >0.5ms                                  | Type            |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- | --------------- |
| computedOper                             | useComputed initial evaluation                  | create-1k (1.6ms), create-10k (6.6ms), append-1k (1.0ms) | alien-signals   |
| get                                      | Proxy get handler                               | create-1k (1.3ms), create-10k (1.4ms), select (1.2ms)    | supergrain      |
| Tracked                                  | tracked() wrapper function                      | create-10k (1.3ms), remove (1.0ms)                       | supergrain      |
| useStore                                 | useContext call                                 | create-10k (1.3ms)                                       | React hook      |
| useRef                                   | hook mount                                      | create-10k (1.3ms)                                       | React hook      |
| link2                                    | alien-signals dependency linking                | create-10k (1.3ms)                                       | alien-signals   |
| commitHookEffectListMount                | React mounting useEffect                        | create-10k (1.3ms)                                       | React lifecycle |
| updateComputed                           | computed re-evaluation on update                | partial-update (1.5ms)                                   | alien-signals   |
| checkDirty2                              | dirty check across 1000 computeds               | select (1.3ms)                                           | alien-signals   |
| propagate2                               | signal propagation                              | select (1.0ms)                                           | alien-signals   |
| recursivelyTraversePassiveUnmountEffects | React useEffect cleanup traversal               | clear (1.5ms)                                            | React lifecycle |
| completeUnitOfWork                       | React fiber completion (more hooks = more work) | create-1k (3.5ms), create-10k (2.5ms), append-1k (1.2ms) | React lifecycle |

**Important caveat**: `completeUnitOfWork` appearing in SG but not RH is an **inference** that more hooks per component causes more fiber completion work. It could also be caused by deeper component nesting (tracked wraps memo wraps the component). The profile only shows self time, not why it's higher.

### Below profiler threshold (inferred from architecture)

Per-Row overhead invisible in profiles but confirmed by the aggregate script gap:

- **5 hooks per Row** (useReducer + useRef + useEffect + useMemo + useContext) vs 0 in react-hooks. For 1000 rows: 5000 hook mount operations, each ~1µs. Estimated: ~5ms for 1k, ~50ms for 10k. This matches the create-10k script gap of +41ms.
- **1000 alienEffect() creations** — reactive graph node allocation + closure.
- **1000 getCurrentSub()/setCurrentSub() pairs** — subscriber context save/restore per render.
- **~3000 proxy get traps** — item.id, item.label, item.id (in onClick) per row.

This is inference, not measurement. The per-operation cost is below sampling resolution.

### For component overhead (separate from Row)

For is `tracked()` itself — 3 hooks. Plus the swap detection `useIsomorphicLayoutEffect` (no deps array) rebuilds an alienEffect on every For render:

1. Disposes old effect (unsubscribes from N index signals)
2. Creates new effect (subscribes to N+delta index signals)

For append 1k→2k: 1000 unsubscribe + 2000 subscribe = 3000 signal graph operations. This is measured indirectly — it's part of the script gap on append but isn't isolated in profiles.

### Paint is identical (measured)

Trace data confirms layout, style recalc, and paint are the same between SG and RH:

| Benchmark  | SG Layout | RH Layout | SG Style | RH Style |
| ---------- | --------- | --------- | -------- | -------- |
| create-1k  | 18.8ms    | 18.8ms    | 9.6ms    | 9.6ms    |
| create-10k | 173.7ms   | 173.7ms   | 87.2ms   | 87.2ms   |
| append-1k  | 22.1ms    | 22.1ms    | 9.1ms    | 9.1ms    |
| swap       | 8.9ms     | 8.9ms     | 6.4ms    | 6.4ms    |

Same DOM structure, same CSS → same browser rendering work. The gap is entirely JavaScript.

## Where supergrain wins

### swap: SG 57.9ms vs RH 197.4ms (p < 0.001)

SG script: 1.4ms. RH script: 30.2ms. SG paint: 26.3ms. RH paint: 137.2ms.

For detects a 2-element swap via alienEffect and moves DOM nodes directly. Zero React re-renders. react-hooks must re-render Main → 1000 createElement → full keyed reconciliation → `insertBefore` 23.5ms (profiled). Paint is 5× more in RH because reconciliation moves ~1000 DOM nodes vs SG's 2.

### replace-1k: SG 58.8ms vs RH 59.6ms (total p > 0.10, script SG -1.0ms p < 0.001)

SG is faster on script by 1.0ms (measured). Total time difference is not significant. Both unmount 1000 and mount 1000; the signal-based approach produces marginally less reconciliation work.

## Script time (all significant at p < 0.001)

Every script delta is statistically significant in the parallel run, and 8 of 9 reproduce in the interleaved run:

| Benchmark      | SG script | RH script | Δ     | Par p   | Int Δ | Int p            |
| -------------- | --------- | --------- | ----- | ------- | ----- | ---------------- |
| create-1k      | 8.0       | 7.0       | +1.0  | < 0.001 | +0.6  | < 0.001          |
| replace-1k     | 14.1      | 14.9      | -1.0  | < 0.001 | +2.6  | > 0.10 (outlier) |
| partial-update | 6.7       | 4.3       | +2.2  | < 0.001 | +2.9  | < 0.001          |
| select         | 5.2       | 3.4       | +1.7  | < 0.001 | +2.3  | < 0.001          |
| swap           | 1.4       | 30.2      | -29.0 | < 0.001 | -30.4 | < 0.001          |
| remove         | 3.1       | 1.5       | +1.6  | < 0.001 | +2.1  | < 0.001          |
| create-10k     | 260.2     | 220.1     | +41.3 | < 0.001 | +45.8 | < 0.001          |
| append-1k      | 10.6      | 7.1       | +3.5  | < 0.001 | +3.7  | < 0.001          |
| clear          | 25.0      | 23.1      | +1.7  | < 0.001 | +2.0  | < 0.05           |

Weighted script gap (all significant): **+6.6ms** (including swap's -8.1ms win). Excluding swap: **+14.7ms**.

## Ideas

### IDEA 1: Reduce tracked() from 3 hooks to 1

**What it targets**: The only benchmarks with significant total-time losses are create-10k (+47.6ms), append-1k (+3.7ms), and select (+2.5ms). Create-10k is dominated by per-component setup — profile shows `useRef` 1.3ms, `commitHookEffectListMount` 1.3ms, `completeUnitOfWork` 2.5ms (inferred: extra fiber completion work from more hooks). These are direct costs of useRef and useEffect in tracked().

**What changes**: Store effect node on the `forceUpdate` dispatch function (stable per component). Remove useRef. Remove useEffect — don't dispose alienEffect on unmount. React 18+ ignores forceUpdate on unmounted components. Effect is GC'd when the dispatch function is collected.

**Expected total-time impact**: The significant losses are create-10k (47.6ms, weight 0.21) and append-1k (3.7ms, weight 0.56). Profile data shows 2.6ms of directly attributable function time on create-10k (useRef + commitHookEffectListMount). The remaining ~38ms is below profiler threshold — 20000 eliminated hook operations × ~1-2µs each could account for 20-40ms. Actual impact on total time must be measured — script savings may or may not survive paint variance for 1k benchmarks.

**Risk**: Alien-signals effects leak until GC. In benchmark: GC runs between operations. In production: orphaned effects accumulate until GC collects the dispatch function. No functional breakage — only memory pressure.

**Not in failed approaches**: No prior experiment addresses tracked() hook count.

### IDEA 2: Remove useContext from Row

**What it targets**: `useStore` at 1.3ms in create-10k profile. One of the 5 hooks per Row.

**What changes**: Pass `store` as prop from For's children callback instead of Row calling `Store.useStore()`.

**Combined with Idea 1**: 5 → 2 hooks per Row (useReducer + useMemo). 60% fewer hook operations.

**Expected total-time impact**: Additive with Idea 1. The useContext cost is small per-call but compounds — 10000 calls on create-10k.

**Risk**: API change — Row must receive store explicitly.

**Not in failed approaches**: No prior experiment addresses useContext in Row.

### IDEA 3: Cache React elements in For

**What it targets**: append-1k total-time loss (+3.7ms, weight 0.56). For calls `children(each[i], i)` for all 2000 items. 1000 are unchanged — their createElement + memo comparison is wasted.

**What changes**: `useRef(new Map<key, ReactElement>())` in For. Reuse elements when proxy identity matches. React's `prevElement === nextElement` fast path skips memo comparison entirely.

**Expected total-time impact**: Eliminates 1000 createElement + 1000 memo comparisons on append. Unknown how much of the +3.7ms gap this represents — could be most of it (if the gap is createElement overhead) or little (if the gap is per-component setup that Ideas 1+2 address).

**Risk**: Stale elements if callbacks aren't stable. Safe in benchmark (useCallback with []). Adds a useRef hook to For (partially offsets Idea 1 if applied to For itself).

**Not in failed approaches**: No prior experiment caches React elements across For re-renders.

### IDEA 4: Reduce computed dependency count for select

**What it targets**: select total-time loss (+2.5ms, weight 0.14). Profile shows `checkDirty2` (1.3ms) + `propagate2` (1.0ms) = 2.3ms for alien-signals propagating to 1000 computed subscribers.

**What changes**: The computed `() => store.selected === item.id` subscribes to both `store.selected` and `item.id`. Since `item.id` never changes, halving the dependency edges could speed propagation.

**Expected total-time impact**: Low weighted impact (0.14 weight). Even eliminating the entire +2.5ms gap saves only 0.35ms weighted.

**Risk**: alien-signals tracks all signal reads inside a computed — there's no API to selectively ignore reads. Would require reading `item.id` outside the computed and capturing it in a closure: `const id = item.id; useComputed(() => store.selected === id)`. This changes what the computed subscribes to.

**Not in failed approaches**: No prior experiment targets computed dependency count.

## Recommendation

**Measure Ideas 1+2 together first.** They target the same cost (per-component hooks), are additive, and affect the benchmarks with the largest significant total-time gaps (create-10k, append-1k). Implement, run `pnpm perf:stats` against the existing baseline, and check if total time improves on create-10k and append-1k.

If total-time improvement is significant, ship it. If not — the script savings are real but the benchmark score won't change because paint variance dominates.

Idea 3 is worth trying only if Ideas 1+2 don't close the append-1k gap. Idea 4 has the lowest expected impact (0.35ms weighted ceiling) and should only be pursued if everything else is exhausted.
