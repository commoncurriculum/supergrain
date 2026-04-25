# Benchmark Results: Proxy vs Direct Signal Access

## Executive Summary

We conducted performance benchmarks comparing proxy-based state access (hiding signals) versus direct signal access (exposing signals). The results show that **direct signals are 2-15x faster** depending on the operation, with the most significant differences in nested object access and array operations.

## Detailed Results

### 1. Simple Property Access

- **Proxy**: 7,896,038 ops/sec
- **Direct Signal**: 16,697,975 ops/sec
- **Speedup**: **2.11x**

```javascript
// What we measured:
proxyState.count;
proxyState.value;
proxyState.text;
// vs
countSignal();
valueSignal();
textSignal();
```

### 2. Nested Object Access

- **Proxy**: 3,617,618 ops/sec
- **Direct Signal**: 52,049,447 ops/sec
- **Speedup**: **14.39x** ⚠️

```javascript
// What we measured:
proxyState.user.profile.name;
proxyState.user.profile.address.city;
// vs
userSignal().profile.name;
userSignal().profile.address.city;
```

### 3. Array Iteration (100 items)

- **Proxy**: 62,404 ops/sec
- **Direct Signal**: 970,520 ops/sec
- **Speedup**: **15.55x** ⚠️

```javascript
// What we measured:
for (const item of proxyState.items) {
  sum += item.value;
}
// vs
const items = itemsSignal();
for (const item of items) {
  sum += item.value;
}
```

### 4. Reactive Updates

- **Proxy**: 566,907 ops/sec
- **Direct Signal**: 2,045,337 ops/sec
- **Speedup**: **3.61x**

```javascript
// What we measured:
updateProxy({ $set: { count: value } });
// vs
countSignal(value);
```

### 5. Computed Values

- **Proxy**: 19,496,332 ops/sec
- **Direct Signal**: 46,082,949 ops/sec
- **Speedup**: **2.36x**

### 6. Many Subscriptions (100 components)

- **Proxy Setup**: 0.21ms
- **Direct Signal Setup**: 0.05ms
- **Speedup**: **4.55x**

## Analysis

### Where Proxy Overhead Matters Most

1. **Nested Object Access**: 14x slower - Each property access goes through a proxy
2. **Array Iterations**: 15x slower - Every array element access is proxied
3. **Many Small Reads**: The overhead compounds with frequent access

### Where It Doesn't Matter Much

1. **Simple Properties**: Only 2x slower, still millions of ops/sec
2. **Computed Values**: Both are very fast (19M vs 46M ops/sec)
3. **Updates**: 3.6x difference, but both are fast enough for UI updates

## Real-World Impact

### Negligible Impact Scenarios (99% of apps)

- **User interactions**: Humans click/type at ~10-100 Hz
- **State updates**: Even "slow" proxy updates handle 500K+ ops/sec
- **Small component trees**: <100 components with simple state
- **CRUD applications**: Forms, dashboards, admin panels

### Potential Performance Issues

- **Large lists**: Rendering 1000+ items with complex nested data
- **Real-time visualizations**: 60 FPS animations reading many properties
- **Data grids**: Virtual scrolling through large datasets
- **Games**: Frame-critical updates with complex state

## Recommendations

### Use the Hidden Signals Approach (Proxy-based) When:

✅ Building typical React applications
✅ Prioritizing developer experience
✅ Working with teams of varying skill levels
✅ State structure is relatively flat
✅ Performance is not a measured bottleneck

### Consider Exposing Signals When:

⚠️ Rendering large lists (1000+ items)
⚠️ Building data-intensive visualizations
⚠️ Implementing smooth animations (60 FPS)
⚠️ Profiling shows state access as bottleneck
⚠️ Working with deeply nested objects

## Proposed Solution: Hybrid Approach

```javascript
// Default: Simple, proxy-based API
const [state, update] = useGranary({
  /* ... */
});

// Escape hatch: Performance-critical paths only
const [state, update, signals] = useGranary(
  {
    /* ... */
  },
  { exposeSignals: true }, // Optional, only when needed
);
```

This gives us:

- **Simple by default**: 99% of users never see signals
- **Fast when needed**: Power users can optimize hot paths
- **Progressive disclosure**: Complexity only when justified

## Conclusion

While direct signals are significantly faster (2-15x), the proxy approach is still fast enough for the vast majority of React applications. The absolute performance (millions of ops/sec) far exceeds typical application needs.

**Recommendation: Hide signals by default, provide escape hatch for power users.**

The developer experience benefits of the simpler API outweigh the performance cost for most use cases. React's own overhead (VDOM diffing, reconciliation) is likely to be a bigger bottleneck than proxy access in real applications.
