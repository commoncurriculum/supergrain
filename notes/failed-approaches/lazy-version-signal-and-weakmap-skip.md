# lazy-version-signal-and-weakmap-skip

## What was tried

Two create-path allocation trims, measured together (each is below the noise
floor alone):

1. **Lazy `$VERSION`**: `getNodes()` stopped auto-creating the `$VERSION`
   signal on first access; instead `bumpVersion()` (writes) and
   `trackArrayVersion()` (tracked array reads) created it on demand via
   `getNode(nodes, $VERSION, 0)`. Collections' `bumpVersionSignal`/
   `bumpOwnKeys` became tolerant of a missing signal.
2. **WeakMap skip**: `createReactiveProxy` only wrote to the `proxyCache`
   WeakMap when `Object.defineProperty(target, $PROXY, ...)` threw
   (sealed/non-configurable targets), since the `$PROXY` fast path shadows the
   WeakMap for every normal object.

## Hypothesis

create-1k materializes 1,000 row proxies, each with a nodes object + eager
`$VERSION` signal (never subscribed for plain row objects) + a redundant
WeakMap write. Dropping ~2,000 allocations/hash-writes should shave create
script time.

## Results

Measured 2026-07-27 against the temporally-adjacent `c2-deferred-dispose` run
(the experiment stacked on accepted C2):

| Benchmark              | ref script | cr34 script | diff (mean)          | diff (median) |
| ---------------------- | ---------- | ----------- | -------------------- | ------------- |
| create rows (1k)       | 26.6       | 27.5        | +3.4%                | +4.6%         |
| create many rows (10k) | 618.9      | 650.6       | +5.1%                | +19%          |
| partial update (10th)  | 23.3       | 27.3        | **+17.3%**           | **+11.5%**    |
| remove row             | 8.0        | 9.3         | +17.1% (median flat) | +0.2%         |
| clear rows             | 86.7       | 87.8        | +1.3%                | -0.7%         |

## Why it failed

No create win materialized — alien-signals' `signal()` is an object literal +
`bind`, cheap enough that 1,000 of them don't register above this machine's
noise. Meanwhile partial update regressed on both mean and median, beyond the
session's observed drift band (3-6%): `bumpVersion` went from a monomorphic
`nodes[$VERSION]` load + call to `getNodes()` + `getNode()` calls per write,
and `getNode` gained a new polymorphic call site (symbol keys from the write
path). Consistent with the repo's standing lesson: micro-restructuring around
the hot read/write paths perturbs V8 more than the saved allocations are
worth.

Reverted in full.

## Addendum (2026-07-27, later the same day): verdict suspect — likely GC aliasing

The D1 `$ELEMENTS` experiment (`notes/performance/elements-signal-plan.md`,
"D1 verdict") demonstrated on this same VM that **allocation-reducing changes
produce phantom regressions in free-running benchmark mode**: removing
~200KB of per-cycle signal allocations made create-1k appear +18-36% slower
(reproduced, interleaved), yet the regression vanished completely when a full
GC was forced before each timed click. Mechanism: less garbage per cycle
shifts where V8's scavenge threshold is crossed relative to the measured
window.

This experiment fits that fingerprint exactly: it reduced allocations
(lazy `$VERSION`, skipped WeakMap writes), expected a create win, and was
rejected on partial-update +17.3% mean / +11.5% median and create-10k
+5.1% mean / +19% median — churn-heavy benchmarks judged in free-running
mode against a block (non-interleaved) reference. The V8-polymorphism
explanation is also weakened: D1 added a symbol-key `getNode` call site and
restructured the same write-path branch, and showed no such cost under
controlled GC.

**If retested, use the newer protocol:** interleave the two builds
(alternate kernel dist within one window) and disambiguate any regression
with the forced-GC variant (`PROFILE=1` + `-t <benchmark>`). The original
verdict here should not be treated as final.
