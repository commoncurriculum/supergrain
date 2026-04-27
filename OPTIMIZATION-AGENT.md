# Performance Optimization Agent Instructions

You are working on the `optimize-benchmark-v3` branch of supergrain, a reactive store library. Your goal is to improve performance on the js-framework-benchmark (Krause benchmark) suite.

## Before You Start

1. **Read `CLAUDE.md`** — project structure, required checks, benchmarking rules.
2. **Read all files in `notes/failed-approaches/`** — extensive documentation of 16+ failed optimization approaches. Do NOT retry anything documented there unless you have a fundamentally different approach.
3. **Read `notes/performance/`** — profiling results, architecture analysis, and optimization history.
4. **Run `git diff main` on `packages/core` and `packages/react`** to understand the current branch state yourself. Don't rely on this document for that — it may be stale.
5. **Profile the current code** to find actual bottlenecks before proposing any changes:
   ```bash
   cd packages/js-krauset
   pnpm perf:profile
   pnpm perf:analyze
   ```

### Key Lessons from Prior Failed Approaches (`notes/failed-approaches/`)

These are extensively documented. Read the full files before attempting anything similar.

**Micro-optimizations that hurt V8 inlining:**

- Extracting proxy get handler into named function caused +18% regression (`091ce55`, also `inline-primitive-checks-optimization.md`)
- Adding `typeof` checks to skip `wrap()`/`unwrap()` for primitives — V8 already inlines these; extra branches add polymorphism
- WeakMap for node storage — slower hot-path access than direct symbol property (`weakmap-node-storage-optimization.md`)
- Slot caching (`c0dd2c7`) — net-negative on benchmarks

**Compiled/alternative read paths that can't beat proxy:**

- `readSignal()` compilation — 0.57-0.94x speed of proxy, identical work + function call overhead (`readSignal-function-call.md`, `per-level-readSignal-compilation.md`)
- `compiled-reads-investigation.md` in `notes/performance/` — only `createView()` with prototype getters (10x faster reads) and `$$()` direct DOM bindings beat proxy

**React integration approaches that failed:**

- `useSyncExternalStore` replaced `useReducer` — added overhead on all operations (`01617b3`)
- Direct component subscriptions, React Context, manual track functions — all slower than proxy-based per-access subscriber swapping (`react-tracking-approaches.md`)
- Removing try/finally from hot paths (with USSE) — partial, part of the reverted USSE exploration (`26b3adb`)
- DirectFor, `$$()` direct bindings, useScopedTracked — all failed except `tracked()` wrapper (`react-optimization-experiments-2026-03.md`)
- Reconciliation performance attempt was reverted (`210418c`)

**Architectural dead ends:**

- Eager signal preallocation — sub-tree replacement makes pre-allocated signals worthless (`eager-signal-preallocation.md`)
- Context switching reduction (N×3 → 2 per render) — race conditions break dependency tracking (`context-switching-optimization.md`)
- Bypassing automatic dependency tracking — fundamentally breaks reactivity (`reactivity-breaking-optimizations.md`)
- Direct DOM bypass (bypassing React reconciler) — no SSR support (`direct-dom-bypass.md`)
- Signal prototype optimization — extracted methods lose binding (`signal-prototype-optimization.md`)

**Still open for exploration:**

- TrackedState / reduce closures in tracked() — attempted as part of useSyncExternalStore rewrite but was never tried with useReducer. **Open for re-exploration** with the current useReducer approach.
- Reconciliation redundancy investigation (`notes/performance/reconciliation-optimization.md`) — hypothesis that `reconcile()` duplicates work already done by `setProperty`. Not yet tested.

## Benchmarking Commands

All commands run from `packages/js-krauset`:

```bash
# Single benchmark run (fast, no profiling overhead)
pnpm test:perf

# Statistical run (N runs, computes mean/median/stddev/min/max)
pnpm perf:stats <name> <runs>

# Compare two statistical runs (includes Krause weights)
pnpm perf:compare <baseline> <compare>

# CPU profile (function-level flame graph + heap tracking, adds overhead — do NOT use for timing)
pnpm perf:profile

# Analyze CPU profiles (top functions by self time)
pnpm perf:analyze           # all benchmarks
pnpm perf:analyze create-1k # specific benchmark
```

## Workflow for Each Optimization

**Every experiment is measured independently against the same baseline.** Do not stack changes. If you accept experiment A and then want to try experiment B, revert A first and measure B against the original baseline. Only after all experiments are individually validated should you combine the winners.

### 1. Use the existing baseline

A 15-run baseline already exists at `packages/js-krauset/perf-stats-branch.json` (the current branch code). Use it for all comparisons:

```bash
cd packages/js-krauset
pnpm perf:compare branch <experiment-name>
```

If you need to re-establish it for any reason: `pnpm perf:stats branch 15`

### 2. Profile to find what to optimize

```bash
pnpm perf:profile
pnpm perf:analyze
```

Read the output. Only optimize what the profiler tells you is actually slow. Do not guess.

### 3. Make your change

Edit files in `packages/core/src/` and/or `packages/react/src/`. Keep changes small and isolated — **one optimization per experiment.**

### 4. Benchmark it (15 runs, no exceptions)

```bash
pnpm perf:stats <experiment-name> 15
pnpm perf:compare branch <experiment-name>
```

### 5. Decide: accept or reject

**Accept if:**

- Weighted total improves with no high-weight benchmark (weight >= 0.4) regressing more than 2-3%
- Small regressions on low-weight benchmarks (select row w=0.19, swap rows w=0.13) are acceptable if the weighted total improves

**Reject if:**

- Weighted total regresses at all
- Any high-weight benchmark regresses more than 5%
- Improvement is within noise (check stddev — if the means are closer than 1 stddev apart, it's noise)

### 6. Log the result

**If rejected:** Revert your code change, then create a file in `notes/failed-approaches/<experiment-name>.md`:

```markdown
# <experiment-name>

## What was tried

<description of the change>

## Hypothesis

<why you expected it to help>

## Code

<paste the relevant code diff or key code snippets — enough that someone can understand exactly what was changed without needing the commit>

## Results

<paste the full pnpm perf:compare output>

## Why it failed

<analysis — what did the profiler show? why didn't the hypothesis hold?>
```

**If accepted:**

1. Run all checks first:

   ```bash
   pnpm test
   pnpm run test:validate
   pnpm run typecheck
   pnpm lint
   pnpm format
   ```

   All five must pass before committing.

2. Commit with a simple `-m` flag — **do NOT use heredocs, string interpolation, or `$(cat ...)` in commit messages** as these require manual approval. Just use a plain quoted string:

   ```bash
   git add <files>
   git commit -m "Optimize bumpVersion: -3.2% weighted total"
   ```

3. Revert the working tree back to baseline before starting the next experiment:
   ```bash
   git stash
   ```
   The commit is saved in git history — you can cherry-pick winners at the end.

### 7. After all experiments: combine winners

Cherry-pick the accepted commits together and run one final 15-run benchmark (`pnpm perf:stats combined 15`, then `pnpm perf:compare branch combined`) to confirm they don't interfere with each other. If the combination regresses, bisect which pair of changes conflicts and drop the less impactful one.

## Krause Benchmark Weights

| Benchmark              | Weight | Priority |
| ---------------------- | ------ | -------- |
| create rows (1k)       | 0.64   | High     |
| replace all rows       | 0.56   | High     |
| partial update (10th)  | 0.56   | High     |
| select row             | 0.19   | Low      |
| swap rows              | 0.13   | Low      |
| remove row             | 0.53   | High     |
| create many rows (10k) | 0.56   | High     |
| append rows (1k to 1k) | 0.55   | High     |
| clear rows             | 0.42   | Medium   |

A 5% improvement on create-10k (weight 0.56, ~580ms) matters far more than a 20% improvement on select-row (weight 0.19, ~11ms).

## Architecture — Where Time Is Spent

The library uses alien-signals as the reactivity engine. Signals are lazily created per-property. The proxy handler intercepts reads (to track dependencies) and writes (to notify signals).

**Hot paths:**

- **Proxy read handler** (`packages/core/src/read.ts`) — every property access goes through this
- **Proxy write handler** (`packages/core/src/write.ts`) — every property set goes through this
- **Signal bookkeeping** — `getNodes()`, `getNodesIfExist()`, `bumpVersion()`, `bumpSignals()`, `bumpOwnKeysSignal()`
- **React hook** (`packages/react/src/use-store.ts`) — `useGranary` hook creates an alien-signals `effect()` per component, uses `useReducer` for re-render triggers
- **For component** (`packages/react/src/use-store.ts`) — list rendering, must handle keyed updates efficiently

Don't trust this list blindly — **profile first** and let the data tell you where time is actually spent.

Note: The build is unminified (`minify: false` in vite.config.ts) so `pnpm perf:profile` / `pnpm perf:analyze` show real function names. `pnpm test:perf` (for timing) uses the same unminified build — this is intentional so profiles and benchmarks run the same code.

## Rules

- **NEVER write custom benchmark scripts.** Use `perf.test.ts` and the pnpm commands above.
- **NEVER dismiss consistent results as noise.** If it's consistently higher across 15 runs, it's real.
- **NEVER skip the 15-run statistical comparison.** Single runs are meaningless for decision-making.
- **NEVER stack changes.** Each experiment is measured independently against baseline.
- **SSR must always work.** Never assume client-only.
- **One optimization per experiment.** If you change two things and get a 5% improvement, you don't know which one helped.
- **Do NOT push to remote.** Commit locally. The project owner will review and push.
- **Do NOT use heredocs, string interpolation, or `$(cat ...)` in git commit messages.** Use plain `git commit -m "message"`. Complex shell constructs require manual approval which won't be available.
- **Do NOT write bash scripts, python scripts, or ad-hoc node scripts.** Edit source files, run the existing pnpm commands, use git. That's it. No creative tooling.
