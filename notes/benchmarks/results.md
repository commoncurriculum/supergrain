# Proxy vs Direct Signal Access

> **Status**: Current. Measures the DX/performance tradeoff of hiding signals behind proxies.
> **TL;DR**: Direct signals are 2-15x faster than proxy access. Biggest gaps in nested objects (14x) and arrays (15x). Simple properties only 2x, and both are millions of ops/sec. Conclusion: hide signals by default, proxy overhead is acceptable for 99% of apps.

## Results

| Operation | Proxy (ops/sec) | Direct Signal (ops/sec) | Speedup |
|-----------|----------------|------------------------|---------|
| Simple property access | 7,896,038 | 16,697,975 | 2.11x |
| Nested object access | 3,617,618 | 52,049,447 | **14.39x** |
| Array iteration (100 items) | 62,404 | 970,520 | **15.55x** |
| Reactive updates | 566,907 | 2,045,337 | 3.61x |
| Computed values | 19,496,332 | 46,082,949 | 2.36x |
| 100 subscriptions setup | 0.21ms | 0.05ms | 4.55x |

### What Was Measured

```javascript
// Proxy access
proxyState.count; proxyState.user.profile.name;
for (const item of proxyState.items) { sum += item.value }
updateProxy({ $set: { count: value } })

// Direct signal access
countSignal(); userSignal().profile.name;
const items = itemsSignal(); for (const item of items) { sum += item.value }
countSignal(value)
```

## Where Overhead Matters

**Significant** (10x+): Nested object access, array iteration -- each access goes through proxy
**Moderate** (2-4x): Simple properties, updates, computed values -- still millions of ops/sec

## Real-World Impact

Proxy overhead is negligible for most apps:
- User interactions at ~10-100 Hz
- Even "slow" proxy updates: 500K+ ops/sec
- CRUD apps, forms, dashboards: no issue

Proxy overhead may matter for:
- 1000+ item lists with nested data
- 60 FPS animations reading many properties
- Large data grids with virtual scrolling

## Conclusion

Hide signals by default. Proxy overhead (2-15x) is dwarfed by React's own reconciliation overhead in practice. Direct signal exposure trades DX for performance -- not worth it for typical apps.
