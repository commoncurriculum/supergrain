# for-passive-swap-effect

## What was tried

Moved `For`'s swap-detection effect from `useLayoutEffect` to a passive
`useEffect`, snapshotting `prevRawRef` during render (instead of inside the
effect) so the effect's first run could still detect and repair element swaps
landing in the commit→passive gap. Effect disposal was marked dead
synchronously (a `disposed` flag guarding the effect body) and the
alien-signals unlink deferred past paint via a shared disposal queue
(`packages/kernel/src/react/disposal-queue.ts`).

## Hypothesis

The swap effect's setup pass touches every index (`node()` or `void each[i]`),
creating and linking 1,000 per-index signals inside the commit on create-1k /
create-10k, and its teardown unlinks 1,000 deps synchronously on clear. Moving
setup to a passive effect and teardown past paint should push that work out of
the measured window (Krause's duration ends at the first compositor Commit
after the last main-thread activity).

## Code

```tsx
// for.ts (experiment): useEffect instead of useIsomorphicLayoutEffect,
// render-time snapshot, dead-flag + deferred unlink
useEffect(() => {
  if (!parent) return;
  swapCleanupRef.current?.();
  swapCleanupRef.current = null;
  if (!raw || raw.length === 0) return;
  let disposed = false;
  const cleanup = alienEffect(() => {
    if (disposed) return;
    /* ...unchanged body... */
  });
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      scheduleDisposal(cleanup);
    }
  };
  swapCleanupRef.current = dispose;
  return () => {
    dispose();
    swapCleanupRef.current = null;
  };
});
// render (parent branch): prevRawRef.current = raw.slice();
```

## Results

Measured 2026-07-27 on a cloud VM (software rendering; script means are the
reliable signal, totals are paint-noise-dominated). Compared against a
temporally-adjacent identical-code baseline (`base2`) because this box drifts
3-6% per hour (see below):

| Benchmark              | base2 script | c3 script | diff  |
| ---------------------- | ------------ | --------- | ----- |
| create rows (1k)       | 25.7         | 25.9      | +0.8% |
| create many rows (10k) | 656.1        | 677.8     | +3.3% |
| clear rows             | 90.2         | 91.1      | +1.0% |
| replace all rows       | 46.6         | 46.1      | -1.1% |
| swap rows              | 2.9          | 3.0       | +3.4% |

Everything within noise. No benchmark improved.

## Why it failed

React flushes passive effects in a MessageChannel task that runs **before the
next paint** in practice, so "passive" does not mean "after the measured
window" — the per-index subscription pass still lands inside Krause's duration
(click → first Commit after last main-thread activity). Only work scheduled
via rAF→setTimeout reliably lands after the Commit. The deferred _teardown_
half does escape the window, but the swap effect has only ~1,000 cheap pointer
unlinks — too small to see at this machine's noise floor.

Net: added lifecycle complexity (dead-flag, render-time ref mutation, a real
commit→passive desync window for non-click mutation sources) for zero measured
gain. Rejected.

## Session note: baseline drift on cloud VMs

During this session, two 15-run baselines of **identical code** ~1 hour apart
differed by: create-1k script +4.9%, replace script -12.6%, create-10k script
+5.6% (median +18%). Per-experiment comparisons against a stale baseline are
meaningless at that drift level. Compare every experiment against a
temporally-adjacent baseline re-run, or interleave.
