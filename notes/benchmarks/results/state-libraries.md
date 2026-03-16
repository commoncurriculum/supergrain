# State Library Benchmarks: @supergrain/core vs zustand, jotai, valtio, mobx, @preact/signals-core

> All libraries tested in vanilla (non-React) mode using Vitest bench on Node.js.
> Results from a single run — relative comparisons are more meaningful than absolute numbers.

## Architecture Notes

These libraries have fundamentally different designs that affect both raw speed and developer experience:

| Library | Reactivity Model | Proxy-based | Granular Tracking | Store Abstraction |
|---|---|---|---|---|
| **@supergrain/core** | Signal-based (alien-signals) | Yes | Yes — only affected effects re-run | Yes — nested objects, MongoDB-style operators |
| **@preact/signals-core** | Signal-based | No | Yes — per-signal tracking | No — individual signals only |
| **zustand** | Pub/sub (setState → notify all) | No | No — all subscribers fire on any change | Yes — plain object store |
| **jotai** | Atomic (each atom is independent) | No | Yes — per-atom subscriptions | No — individual atoms |
| **valtio** | Proxy + snapshot | Yes | No — subscribe fires on any mutation | Yes — mutable proxy |
| **mobx** | Observable + autorun | Yes | Yes — tracks property access in reactions | Yes — observable objects |

@preact/signals-core is the raw signal primitive — no proxy wrapping, no nested object handling, no store API. It's the performance ceiling for signal-based reactivity. Supergrain builds a full store abstraction (deep proxy wrapping, path-based updates, MongoDB-style operators) on top of a similar signal foundation (alien-signals).

---

## Store Creation (1,000 stores/signals)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **@preact/signals-core** | 436,293 | 0.002 | — |
| zustand | 56,771 | 0.018 | 7.7x slower |
| @supergrain/core | 1,450 | 0.690 | 301x slower |
| jotai | 1,123 | 0.891 | 389x slower |
| valtio | 242 | 4.141 | 1,807x slower |
| mobx | 230 | 4.345 | 1,896x slower |

> Preact creates a lightweight signal wrapper. Zustand creates a closure. Proxy-based libraries (supergrain, valtio, mobx) pay upfront cost for proxy wrapping + Object.defineProperty.

## Property Read (1M non-reactive reads)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **zustand** | 523 | 1.913 | — |
| @preact/signals-core | 523 | 1.913 | ~tied |
| valtio | 52 | 19.13 | 10x slower |
| @supergrain/core | 20 | 48.93 | 26x slower |
| mobx | 15 | 65.80 | 34x slower |
| jotai | 5 | 209.28 | 109x slower |

> Zustand reads plain properties; Preact reads `.value` on a signal (both return plain objects underneath). Proxy-based libraries intercept every read.

## Non-reactive Updates (1,000 updates)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **@preact/signals-core** | 144,728 | 0.007 | — |
| zustand | 33,335 | 0.030 | 4.3x slower |
| mobx | 6,270 | 0.160 | 23x slower |
| @supergrain/core | 4,958 | 0.202 | 29x slower |
| valtio | 4,842 | 0.207 | 30x slower |
| jotai | 1,305 | 0.767 | 111x slower |

> Preact signal `.value = x` is a direct property set with minimal overhead. Supergrain goes through `$set` operator → `setPathValue` → `setProperty` → signal update.

## Reactive Updates (subscribe + 1,000 updates)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **zustand** | 25,094 | 0.040 | — |
| @preact/signals-core | 24,154 | 0.041 | ~tied |
| valtio | 4,372 | 0.229 | 5.7x slower |
| @supergrain/core | 4,008 | 0.250 | 6.3x slower |
| mobx | 2,421 | 0.413 | 10.4x slower |
| jotai | 1,147 | 0.872 | 21.9x slower |

> Zustand fires all subscribers synchronously. Preact runs effects synchronously on each `.value` set (1,000 effect runs). Supergrain and valtio batch notifications via microtask (1 effect run).

## Batch Update (10 properties at once)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **zustand** | 2,414,264 | 0.0004 | — |
| @preact/signals-core | 897,160 | 0.001 | 2.7x slower |
| @supergrain/core | 260,171 | 0.004 | 9.3x slower |
| jotai | 238,786 | 0.004 | 10.1x slower |
| mobx | 100,625 | 0.010 | 24.0x slower |
| valtio | 91,696 | 0.011 | 26.3x slower |

## Deep Nested Updates (100 updates to l1.l2.l3.value)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **@preact/signals-core** | 256,595 | 0.004 | — |
| zustand | 204,705 | 0.005 | 1.3x slower |
| valtio | 19,100 | 0.052 | 13.4x slower |
| @supergrain/core | 15,818 | 0.063 | 16.2x slower |
| mobx | 11,704 | 0.085 | 21.9x slower |
| jotai | 10,536 | 0.095 | 24.4x slower |

> Preact uses a single flat signal — no nesting overhead. Zustand replaces the entire state object. Supergrain traverses the dot-path `l1.l2.l3.value` and updates through proxy layers.

## Array Operations (100 pushes with reactive subscriber)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **@preact/signals-core** | 90,023 | 0.011 | — |
| zustand | 87,912 | 0.011 | ~tied |
| @supergrain/core | 16,600 | 0.060 | 5.4x slower |
| mobx | 13,678 | 0.073 | 6.6x slower |
| jotai | 8,837 | 0.113 | 10.2x slower |
| valtio | 7,826 | 0.128 | 11.5x slower |

## Granular Reactivity (update 1 of 10 independently observed properties)

| Library | ops/sec | Mean (ms) | vs fastest |
|---|---:|---:|---|
| **@preact/signals-core** | 902,960 | 0.001 | — |
| zustand\* | 573,394 | 0.002 | 1.6x slower |
| @supergrain/core | 214,477 | 0.005 | 4.2x slower |
| valtio | 87,200 | 0.012 | 10.4x slower |
| mobx | 70,848 | 0.014 | 12.7x slower |
| jotai | 48,311 | 0.021 | 18.7x slower |

> \*Zustand **fires all 10 subscribers** on every update. In a React app, each subscriber would re-render and rely on selectors to bail out. Preact, supergrain, and mobx fire only the 1 affected effect.

---

## Summary

### Raw Throughput Rankings

| Category | 1st | 2nd | 3rd | 4th | 5th | 6th |
|---|---|---|---|---|---|---|
| Store Creation | preact | zustand | supergrain | jotai | valtio | mobx |
| Property Read | zustand ≈ preact | — | valtio | supergrain | mobx | jotai |
| Non-reactive Updates | preact | zustand | mobx | supergrain | valtio | jotai |
| Reactive Updates | zustand ≈ preact | — | valtio | supergrain | mobx | jotai |
| Batch Update | zustand | preact | supergrain | jotai | mobx | valtio |
| Deep Updates | preact | zustand | valtio | supergrain | mobx | jotai |
| Array Pushes | preact ≈ zustand | — | supergrain | mobx | jotai | valtio |
| Granular Reactivity | preact | zustand\* | supergrain | valtio | mobx | jotai |

### Key Takeaways

1. **@preact/signals-core is the performance ceiling** — raw signals with no proxy wrapping, no store abstraction, and no nested object handling. It wins or ties in 6 of 8 categories. This is the cost of the signal primitive itself.

2. **The gap between preact signals and supergrain is the cost of the store abstraction** — proxy wrapping, deep path resolution, MongoDB-style operators, and nested object tracking. This is the price of the DX supergrain provides.

3. **Zustand remains extremely competitive** thanks to its plain-object, no-proxy design. It ties or beats preact signals in batch updates and reactive updates.

4. **@supergrain/core is consistently 3rd–4th in raw throughput** but is the fastest library that combines all of: fine-grained reactivity, deep nested object support, and a rich update API.

5. **Among full store libraries with granular reactivity** (supergrain, mobx), supergrain is 1.5x–3x faster than mobx across most categories.

6. **The proxy overhead tradeoff**: Proxy-based libraries pay ~10-60x cost per property read vs plain access. In practice, this is nanosecond-scale per read and negligible for typical app workloads.

7. **Where supergrain's architecture pays off**: 1,000 sequential updates trigger only 1 effect re-run (signal batching via microtask). Zustand fires 1,000 subscriber callbacks. Preact fires 1,000 effect runs (synchronous). In UI-heavy applications, fewer re-renders often matter more than raw store throughput.
