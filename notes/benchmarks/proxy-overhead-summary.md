# Proxy Overhead Summary

> **Status:** Historical reference. See [proxy-overhead-analysis.md](proxy-overhead-analysis.md) for full details.
>
> **Key finding:** @supergrain/core is 188x-990x slower than direct object access. The overhead is primarily architectural (proxy fundamentals) rather than implementation inefficiency.

## Headline Numbers

| Operation | Overhead vs Direct |
|-----------|-------------------|
| Simple property access | **188.5x** |
| Nested object access | **990.9x** |
| Array operations | **161.3x** |

The original 7x threshold was far exceeded (27x-142x above threshold).

## Root Causes

| Component | Overhead Factor |
|-----------|----------------|
| Basic proxy trap | 45x |
| getCurrentSub() calls | 14x |
| Reflect.get operations | 16x |
| Symbol property access ($NODE, $RAW) | 37x |
| hasOwnProperty checks | 15x |

### Memory Per Wrapped Object

~430+ bytes per object + 200 bytes per property. Includes proxy creation, signal tracking, symbol properties, and WeakMap caching.

### Architectural Issues

1. Every property access goes through 6-8 checks in the proxy handler
2. `getNode()` creation pattern adds 18.8x overhead
3. Eager wrapping turns all nested objects into proxies
4. Multiple indirection layers: Proxy -> getCurrentSub -> Reflect.get -> hasOwnProperty

## Recommendations by Impact

**High (50-70%):** Compile-time optimization, direct signal access APIs, selective wrapping.

**Medium (20-30%):** Cache getCurrentSub(), simplify proxy handler, lazy signal creation, optimize symbol access.

**Low (5-15%):** Property descriptors for known shapes, signal pooling, inline critical operations.

## Conclusion

Achieving sub-10x overhead would require architectural changes (compile-time transforms, direct signal APIs, selective reactivity). The current design intentionally prioritizes DX and API ergonomics over raw read performance.
