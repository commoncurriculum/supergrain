# Performance Optimization Agent Instructions

You are working on the `optimize-benchmark-v3` branch of supergrain, a reactive store library. Your goal is to improve performance on the js-framework-benchmark (Krause benchmark) suite.

## Before You Start

1. **Read `CLAUDE.md`** — it has project structure, required checks, and benchmarking rules.
2. **Read failed experiments** in `packages/js-krauset/failed-experiments/`. Do NOT retry anything already documented there unless you have a fundamentally different approach.
3. **Review the git history** for previously reverted optimizations. These are known failures:
   - `091ce55` — proxyGet extraction caused V8 inlining regression (+18% create 1k)
   - `01617b3` — useSyncExternalStore replaced useReducer, added overhead on all operations. Reverted back to useReducer.
   - `c0dd2c7` — slot caching experiment was net-negative on benchmarks
   - `26b3adb` — removing try/finally from hot paths (with useSyncExternalStore) — partial, was part of the USSE exploration
   - `210418c` — reconciliation performance attempt was reverted
   - TrackedState / reduce closures in tracked() — attempted as part of useSyncExternalStore rewrite but was never tried with useReducer. Open for re-exploration with the current useReducer approach.

   **Important:** These are documented so you don't blindly repeat them. But a fresh approach is encouraged — if you see an opportunity that's similar to a past failure but with a different mechanism or context, try it. Just document your reasoning.

## Branch State

The branch has these changes vs main in `packages/core` and `packages/react`:

**Core changes:**

- `getNodesIfExist()` helper — extracts `(target as any)[$NODE]` into a named function (zero perf impact, confirmed by benchmarks)
- `$TRACK` symbol exported from core instead of duplicated
- Raw `effect` from alien-signals re-exported directly (removed `profiledEffect` wrapper)
- Profiler counters stripped from production builds via `@rollup/plugin-strip`
- `@rollup/plugin-strip` added as devDependency

**React changes:**

- `use-store.ts` rewritten: uses `useReducer` (not `useSyncExternalStore`), imports `effect` from alien-signals directly, uses `getNodesIfExist` and `$TRACK` from core
- `tracked.ts` simplified
- SSR-safe `useIsomorphicLayoutEffect` pattern
- For component simplified (removed CachedForItem)

**Current benchmark results (branch vs main, 15 runs each):**

- Total: -1.5% (branch is faster)
- Big wins: replace -8.4%, remove -9.8%, append -10.2%
- Regressions: create +3.0%, select +7.1% (small absolute terms: 1.3ms, 0.7ms)

## Benchmarking Commands

All commands run from `packages/js-krauset`:

```bash
# Single benchmark run (fast, no profiling overhead)
pnpm test:perf

# Statistical run (N runs, computes mean/median/stddev/min/max)
pnpm perf:stats <name> <runs>

# Compare two statistical runs
pnpm perf:compare <baseline> <compare>

# CPU profile (function-level flame graph + heap tracking, adds overhead)
pnpm perf:profile

# Analyze CPU profiles (top functions by self time)
pnpm perf:analyze           # all benchmarks
pnpm perf:analyze create-1k # specific benchmark
```

## Workflow for Each Optimization

Follow this process exactly:

### 1. Profile first

```bash
cd packages/js-krauset
pnpm perf:profile
pnpm perf:analyze
```

Read the flame graph output. Identify which functions are hot. Only optimize what the data tells you is slow.

### 2. Establish baseline (if you don't already have one)

```bash
pnpm perf:stats baseline 15
```

You only need to do this once. Reuse the baseline for all comparisons.

### 3. Make your change

Edit files in `packages/core/src/` and/or `packages/react/src/`. Keep changes small and isolated — one optimization per experiment.

### 4. Run the full benchmark

```bash
pnpm perf:stats <experiment-name> 15
pnpm perf:compare baseline <experiment-name>
```

### 5. Decide: accept or reject

**Accept if:**

- Weighted total is improved (even slightly) with no individual benchmark regressing more than 2-3%
- OR weighted total is neutral but the change is architecturally beneficial (cleaner code, better maintainability)

**Reject if:**

- Any individual benchmark regresses significantly (>5%) even if total improves
- Total regresses at all
- Improvement is within noise (stddev overlaps)

### 6. Log the result

**If rejected:** Create a file in `packages/js-krauset/failed-experiments/`:

```markdown
# <experiment-name>

## What was tried

<description of the change>

## Hypothesis

<why you expected it to help>

## Results

<paste pnpm perf:compare output>

## Why it failed

<analysis of why it didn't work>

## Commit (if any)

<commit hash, or "not committed">
```

**If accepted:** Commit the change with a clear message describing what was optimized and the benchmark delta.

### 7. After accepting, verify everything still works

```bash
pnpm test
pnpm run test:validate
pnpm run typecheck
pnpm lint
pnpm format
```

All five must pass. Do NOT push without running these.

## Krause Benchmark Weights

These weights determine how much each benchmark matters in the overall score:

| Benchmark              | Weight | Notes                                              |
| ---------------------- | ------ | -------------------------------------------------- |
| create rows (1k)       | 0.64   | High impact                                        |
| replace all rows       | 0.56   | High impact                                        |
| partial update (10th)  | 0.56   | High impact                                        |
| select row             | 0.19   | Low impact — small regressions here are acceptable |
| swap rows              | 0.13   | Low impact — small regressions here are acceptable |
| remove row             | 0.53   | High impact                                        |
| create many rows (10k) | 0.56   | High impact, dominates total time                  |
| append rows (1k to 1k) | 0.55   | High impact                                        |
| clear rows             | 0.42   | Medium impact                                      |

Focus optimization effort on high-weight benchmarks. A 5% improvement on create-10k (weight 0.56) matters far more than a 20% improvement on select-row (weight 0.19).

## Architecture Notes

The hot paths are:

- **Store proxy handler** (`packages/core/src/read.ts` for reads, `packages/core/src/write.ts` for writes) — every property access/set goes through these
- **Signal creation and notification** — `getNodes()`, `getNodesIfExist()`, `bumpVersion()`, `bumpSignals()`, `bumpOwnKeysSignal()`
- **React integration** (`packages/react/src/use-store.ts`) — the `useStore` hook, alien-signals `effect()` for tracking, `useReducer` for triggering re-renders
- **For component** (`packages/react/src/use-store.ts`) — renders lists, must handle keyed updates efficiently

The library uses alien-signals as the reactivity engine. Signals are lazily created per-property via `getNodes()`. The proxy handler intercepts reads (to track dependencies) and writes (to notify signals).

## Rules

- **NEVER write custom benchmark scripts.** Use the existing `perf.test.ts` and the pnpm commands above.
- **NEVER dismiss consistent results as noise.** If it's consistently higher across 15 runs, it's real.
- **NEVER skip the 15-run statistical comparison.** Single runs are meaningless for decision-making.
- **SSR must always work.** Never assume client-only. Test with `typeof document === 'undefined'` in mind.
- **Keep changes isolated.** One optimization per experiment. If you change two things and get a 5% improvement, you don't know which one helped.
- **Do NOT push to remote.** Commit locally. The project owner will review and push.
