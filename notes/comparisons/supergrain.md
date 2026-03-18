# Supergrain (Self-Analysis)

> **Status:** Reference document. Analyzes Supergrain's own architecture, performance characteristics, and position in the ecosystem.
>
> **Note:** This library was previously called "Storable" -- references to "Storable" in other docs refer to this project.

## Architecture

Supergrain is a proxy-based reactive store with automatic fine-grained reactivity. It uses JavaScript Proxy objects + alien-signals for dependency tracking. Nested objects are automatically wrapped in reactive proxies.

| Aspect            | Details                                                                    |
| ----------------- | -------------------------------------------------------------------------- |
| Reactivity        | Proxy traps + alien-signals                                                |
| React Integration | `tracked()` with per-component proxy isolation                             |
| Nested Objects    | Automatic lazy proxy wrapping via `wrap()`                                 |
| Updates           | Direct mutation or MongoDB-style operators (`$set`, `$push`, `$inc`, etc.) |
| Batching          | Automatic via `startBatch`/`endBatch`                                      |

## Memory Model

~200 bytes per wrapped object:

- Proxy object: ~64 bytes
- Signal node: ~32 bytes
- Handler functions: ~48 bytes
- WeakMap entries: ~24 bytes
- Property tracking: ~32 bytes

| Nesting Depth | Memory     |
| ------------- | ---------- |
| 1 level       | ~200 bytes |
| 3 levels      | ~600 bytes |
| 6 levels      | ~1.2KB     |
| 10 levels     | ~2.0KB     |

Updates are in-place with ~50 bytes temporary allocation. No action objects or history accumulation.

## Performance Characteristics

| Operation                      | Performance                              |
| ------------------------------ | ---------------------------------------- |
| Store creation                 | ~1.3ms (root proxy only, nested lazy)    |
| Simple reads                   | ~0.08ms first access, ~0.03ms subsequent |
| Deep reads                     | ~0.13ms                                  |
| Simple updates                 | ~0.5ms                                   |
| Deep updates                   | ~1ms                                     |
| Batch updates (multi-property) | ~0.7ms                                   |
| Complex operations             | ~1.1ms                                   |

Lazy proxy creation: first access to a nested object costs ~1-2ms; subsequent access uses the cached proxy.

## Ecosystem Position

| Library        | Base Memory           | GC Pressure | Architecture              |
| -------------- | --------------------- | ----------- | ------------------------- |
| **Supergrain** | ~200 bytes/object     | Very Low    | Auto-proxy + signals      |
| Zustand        | ~64 bytes total       | Low-Medium  | Plain object + selectors  |
| Valtio         | ~150 bytes/object     | Medium      | Proxy + snapshots         |
| MobX           | ~180 bytes/observable | Medium      | Observer pattern          |
| Jotai          | ~72 bytes/atom        | Medium-High | Atomic decomposition      |
| Redux Toolkit  | ~2KB + actions        | High        | Actions + immutable trees |

## Strengths

1. **Automatic deep reactivity** -- no manual setup for nested objects
2. **In-place updates** -- lowest GC pressure, no immutable overhead
3. **Predictable memory** -- ~200 bytes per object, linear scaling
4. **No selectors needed** -- automatic property-level tracking
5. **Dual update API** -- direct mutations for speed, operators for complex logic

## Weaknesses

1. **Higher read overhead** than plain-object libraries (proxy traps)
2. **Higher baseline memory** than minimalist libraries (Zustand ~64 bytes)
3. **No built-in DevTools** (compared to Redux, MobX)
4. **Proxy requirement** (all modern browsers support this)

## Best Suited For

- Applications with moderate to complex nested state
- Frequent deep mutations where in-place updates matter
- Teams wanting automatic reactivity without manual optimization
- Memory sweet spot: 3-10 levels of nesting
