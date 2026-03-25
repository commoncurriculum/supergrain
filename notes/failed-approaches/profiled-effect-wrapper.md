# FAILED: profiledEffect Wrapper in tracked()

> **Status:** FAILED — Removed
> **Date:** March 2026
> **Commit:** 2fa3062
> **TL;DR:** Wrapping `alienEffect` in a `profiledEffect` higher-order function added an extra closure and double-callback per tracked component. The overhead was measurable in create benchmarks.

## Context

Wanted to profile how much time was spent in alien-signals effect creation and firing for tracked components.

## What Was Tried

```ts
function profiledEffect(fn: () => void) {
  return alienEffect(() => {
    profileTimeStart("trackedEffectTime");
    fn();
    profileTimeEnd("trackedEffectTime");
  });
}

// In tracked():
const dispose = profiledEffect(() => {
  // ... dependency tracking and re-render triggering ...
});
```

## Why It Failed

This creates two closures per tracked component where one sufficed:
1. The outer closure passed to `alienEffect` (the wrapper)
2. The inner `fn` closure (the actual effect body)

For create 1k with 1000 Row components:
- +1000 extra closure allocations
- +1000 extra function calls per effect fire (wrapper calls fn())
- The wrapper closure captures `fn`, adding to the closure's V8 Context size

## What Replaced It

Call `alienEffect` directly and invoke `profileEffectFire()` manually inside the effect body:

```ts
const dispose = alienEffect(() => {
  profileTimeStart("trackedEffectTime");
  // ... dependency tracking and re-render triggering ...
  profileTimeEnd("trackedEffectTime");
});
```

Single closure, no indirection. The profiling calls are inlined in the effect body.

## Key Lesson

Higher-order function wrappers for profiling create measurable overhead in hot paths. When you need to profile a function that runs thousands of times, inline the profiling calls rather than wrapping.
