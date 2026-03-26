# FAILED: TrackedState / Reduce Closures in tracked()

**Date:** March 2026

## What was tried

Replaced closure-captured variables in tracked() (`packages/react/src/tracked.ts`) with a single `TrackedState` object. The alienEffect callback captures one object reference instead of three separate closure variables (`firstRun`, `capturedNode`, `forceUpdate`). The ref value IS the state object, eliminating the separate `{ cleanup, effectNode }` allocation.

This was the "open for re-exploration" item from OPTIMIZATION-AGENT.md — TrackedState was previously attempted as part of a useSyncExternalStore rewrite (which failed for unrelated reasons) but had never been tested with the current useReducer approach.

## Hypothesis

Each tracked component creates an alienEffect closure capturing 3 variables plus a separate `{ cleanup, effectNode }` ref object. Consolidating into a single state object should reduce allocations during initial mount. For create-10k (10k rows), this saves 10k ref objects and simplifies 10k closure contexts.

Expected to help: create-1k, create-10k, replace-1k, append-1k (mount-heavy).
Expected no effect: partial-update, select, swap, remove, clear (re-render or unmount — closures already exist).

## Code

```typescript
// Before:
const ref = useRef<{ cleanup: () => void; effectNode: ReactiveNode | undefined } | null>(null);

if (!ref.current) {
  let firstRun = true;
  let capturedNode: ReactiveNode | undefined = null!;
  const cleanup = alienEffect(() => {
    if (firstRun) {
      capturedNode = getCurrentSub();
      firstRun = false;
      return;
    }
    forceUpdate();
  });
  ref.current = { cleanup, effectNode: capturedNode };
}

// After:
interface TrackedState {
  cleanup: () => void;
  effectNode: ReactiveNode | undefined;
  firstRun: boolean;
  forceUpdate: () => void;
}

const ref = useRef<TrackedState | null>(null);

if (!ref.current) {
  const state: TrackedState = {
    firstRun: true,
    effectNode: undefined,
    forceUpdate,
    cleanup: null!,
  };
  state.cleanup = alienEffect(() => {
    if (state.firstRun) {
      state.effectNode = getCurrentSub();
      state.firstRun = false;
      return;
    }
    state.forceUpdate();
  });
  ref.current = state;
}
```

## Results

Ran two rounds with reversed ordering to control for thermal drift:

**Round 1: Experiment first, baseline second** (thermal advantage to experiment)

```
branch4 (15 runs) vs tracked-state2 (15 runs)

Benchmark                        branch4tracked-state2      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  47.7ms        46.5ms     -2.4%    0.64     -2.4%
replace all rows                  54.5ms        52.3ms     -4.0%    0.56     -4.0%
partial update (10th)             51.7ms        45.4ms    -12.2%    0.56    -12.2%
select row                        11.1ms        10.5ms     -5.2%    0.19     -5.2%
swap rows                         53.3ms        44.2ms    -17.1%    0.13    -17.1%
remove row                        41.8ms        40.1ms     -4.0%    0.53     -4.0%
create many rows (10k)           587.9ms       582.0ms     -1.0%    0.56     -1.0%
append rows (1k to 1k)            54.4ms        52.0ms     -4.5%    0.55     -4.5%
clear rows                        46.0ms        42.1ms     -8.4%    0.42     -8.4%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (weighted):                  499.6         485.7     -2.8%
```

**Round 2: Baseline first, experiment second** (thermal advantage to baseline)

```
branch5 (15 runs) vs tracked-state3 (15 runs)

Benchmark                        branch5tracked-state3      diff  weight  weighted
──────────────────────────────────────────────────────────────────────────────────
create rows (1k)                  47.4ms        47.7ms     +0.6%    0.64     +0.6%
replace all rows                  54.0ms        54.5ms     +0.9%    0.56     +0.9%
partial update (10th)             52.4ms        51.4ms     -1.9%    0.56     -1.9%
select row                        11.6ms        11.1ms     -3.8%    0.19     -3.8%
swap rows                         49.8ms        51.3ms     +3.0%    0.13     +3.0%
remove row                        43.5ms        43.5ms     +0.2%    0.53     +0.2%
create many rows (10k)           589.7ms       599.1ms     +1.6%    0.56     +1.6%
append rows (1k to 1k)            53.4ms        54.6ms     +2.3%    0.55     +2.3%
clear rows                        48.6ms        48.8ms     +0.4%    0.42     +0.4%
──────────────────────────────────────────────────────────────────────────────────
TOTAL (weighted):                  501.6         507.7     +1.2%
```

Results flip with run order: -2.8% when experiment runs first (cooler), +1.2% when baseline runs first. This is thermal drift, not a real improvement.

## Why it failed

1. **Only affects mount, not re-render.** The `if (!ref.current)` block runs once per component lifetime. Partial-update (100 re-renders), select (2 re-renders), swap (0 renders), remove, and clear are all unaffected. Only create-1k/10k and replace (mount-heavy) could benefit — but even there, the effect is not measurable.

2. **V8 treats closures and objects similarly.** A closure context capturing 3 variables and a plain object with 4 properties are both small heap allocations. V8 optimizes both aggressively. The restructuring trades one shape for another of similar cost.

3. **Property access vs scope chain lookup are equivalent.** `state.firstRun` (hidden-class property lookup) and `firstRun` (scope chain variable) are both inlined by V8 to a single memory load.

## Methodological note

This experiment confirmed that thermal drift causes ~3-6% performance shifts over 30 sequential benchmark runs on this machine. Running experiment-first vs baseline-first produces opposite conclusions. Earlier experiments in this session (remove-track-array-version, fast-push, remove-profiler) were compared against stale baselines and likely inflated by this effect. See those files for notes on which results are unreliable.
