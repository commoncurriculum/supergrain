# FAILED: Profiling Instrumentation in Proxy Get Handler

> **Status:** FAILED — Removed
> **Date:** March 2026
> **Commit:** 2fa3062
> **TL;DR:** Adding `profileTimeStart("proxyGetTime")`/`profileTimeEnd("proxyGetTime")` to the proxy get trap caused ~12,000 function calls per create 1k operation. The profiling overhead dwarfed what it was measuring.

## Context

Wanted to measure how much time was spent in the proxy get handler to identify optimization opportunities.

## What Was Tried

```ts
get(target, prop, receiver) {
  profileTimeStart("proxyGetTime");
  // ... existing get handler logic ...
  profileTimeEnd("proxyGetTime");
  return result;
}
```

## Why It Failed

The proxy get handler is the single hottest path in the entire system. Every property read on every store object goes through it. For create 1k:

- 1000 rows × ~4 properties read per row × ~3 reads per property (key check, value, wrap) = ~12,000 get trap invocations
- Each invocation now has 2 extra function calls (`profileTimeStart` + `profileTimeEnd`)
- Plus 2 `performance.now()` calls inside each
- Total: ~48,000 extra function calls per create 1k

The profiling overhead was reporting `proxyGetTime = 6.4ms` but a significant portion of that 6.4ms was the profiling instrumentation itself. The measurement was corrupting what it measured.

## What Replaced It

Removed all profiling from the proxy get handler. Used Chrome CDP tracing (`Performance.enable` + `Tracing.start`) instead, which instruments at the V8 level without adding JavaScript function call overhead.

## Key Lesson

Never add per-invocation JavaScript profiling to a function that runs >1000 times per operation. Use CDP tracing or `performance.measure()` around the entire operation instead. The observer effect is real in JavaScript performance measurement.
