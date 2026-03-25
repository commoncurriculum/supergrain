# FAILED: Profiler via Mutable Function Pointers

> **Status:** FAILED — Replaced with boolean guards
> **Date:** March 2026
> **Commit:** 2fa3062
> **TL;DR:** Implementing the profiler by swapping mutable `let` function bindings prevented V8 from inlining and branch-predicting the calls. Replaced with boolean-guarded regular functions.

## Context

The profiling system needed to be togglable — when profiling is disabled, calls should have zero overhead.

## What Was Tried

```ts
let profileTimeStart: (bucket: TimingBucket) => void = noop;
let profileTimeEnd: (bucket: TimingBucket) => void = noop;

function enableProfiling() {
  profileTimeStart = (bucket) => {
    /* record performance.now() */
  };
  profileTimeEnd = (bucket) => {
    /* accumulate elapsed time */
  };
}

function disableProfiling() {
  profileTimeStart = noop;
  profileTimeEnd = noop;
}
```

The idea was that when profiling is off, `profileTimeStart` and `profileTimeEnd` are just `noop` — zero cost.

## Why It Failed

V8 treats mutable `let` bindings as indirect calls. It cannot:

- Inline the function body at call sites
- Branch-predict based on the current binding
- Optimize away the call when the binding is `noop`

Every call to `profileTimeStart()`/`profileTimeEnd()` goes through V8's generic call path, even when pointing at `noop`. With thousands of calls per benchmark operation, this overhead was measurable.

## What Replaced It

```ts
let _profilingEnabled = false;

function profileTimeStart(bucket: TimingBucket) {
  if (!_profilingEnabled) return;
  // ... record time
}

function profileTimeEnd(bucket: TimingBucket) {
  if (!_profilingEnabled) return;
  // ... accumulate time
}
```

V8 can inline these functions and branch-predict the boolean check. When profiling is off, the branch predictor learns the fast path and the overhead drops to near-zero.

## Key Lesson

Never use mutable function pointer swapping for hot-path toggling in JavaScript. V8 optimizes static function shapes with boolean guards far better than indirect calls through mutable bindings.
