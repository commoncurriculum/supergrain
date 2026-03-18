# MobX Comparison

> **Status:** Reference analysis. MobX is the most architecturally similar competitor -- both use proxy-based fine-grained reactivity.
>
> **Key difference:** MobX uses explicit `observable()` declarations with an observer-pattern dependency graph; Supergrain uses automatic proxy wrapping with alien-signals. Supergrain is 1.5-3x faster in benchmarks.

## Architecture

| Aspect              | MobX                                         | Supergrain                            |
| ------------------- | -------------------------------------------- | ------------------------------------- |
| Observable Creation | Explicit via `observable()` or decorators    | Automatic in `createStore()`          |
| React Integration   | `observer` HOC + `useSyncExternalStore`      | `tracked()`                           |
| Dependency Tracking | Reaction-based observer pattern              | Proxy traps + signal subscriptions    |
| Nested Objects      | Requires explicit `observable()` calls       | Auto-proxied via `wrap()`             |
| State Updates       | Actions + direct mutation                    | Direct mutation or MongoDB operators  |
| Batching            | Manual `runInAction` or automatic in actions | Automatic via `startBatch`/`endBatch` |
| Type System         | Class-based + functional                     | Functional with proxies               |

## React Integration

MobX wraps components with `observer()` HOC, which uses `useSyncExternalStore` internally. During render, a `Reaction` tracks observable dependencies. Each observable maintains an `observers_` set and propagates changes through `propagateChanged()`.

Supergrain's `tracked()` (formerly `useTracked`) creates a per-component proxy that swaps the active subscriber during each property access for perfect nested component isolation.

## Memory Comparison

| Nesting Level | MobX (Manual) | MobX (Auto Deep) | Supergrain |
| ------------- | ------------- | ---------------- | ---------- |
| 1 level       | ~180 bytes    | ~234 bytes       | ~200 bytes |
| 3 levels      | ~540 bytes    | ~702 bytes       | ~600 bytes |
| 6 levels      | ~1.08KB       | ~1.4KB           | ~1.2KB     |
| 10 levels     | ~1.8KB        | ~2.34KB          | ~2.0KB     |

Memory overhead is comparable. MobX can be slightly lower with manual observables but higher with `deep: true`.

## Performance Comparison

| Operation       | MobX                  | Supergrain     | Notes                            |
| --------------- | --------------------- | -------------- | -------------------------------- |
| Creation        | ~1-2ms per observable | ~1.3ms (store) | MobX ~2-4x slower for deep setup |
| Simple reads    | ~0.05ms               | ~0.08ms        | MobX ~37% faster                 |
| Deep reads      | ~0.2ms                | ~0.13ms        | Supergrain faster                |
| Simple updates  | ~0.5ms                | ~0.5ms         | Similar                          |
| Deep updates    | ~1.2ms                | ~1.0ms         | Similar                          |
| Batched actions | ~0.6ms                | ~0.7ms         | Similar                          |

In state library benchmarks, supergrain is 1.5-3x faster than mobx across most categories.

## Key Differences

**MobX advantages:**

- Selective observability (choose which properties are reactive)
- Mature ecosystem with excellent DevTools
- Computed values with automatic memoization
- Action enforcement prevents accidental mutations
- Class-based state support

**Supergrain advantages:**

- Automatic deep reactivity without explicit declarations
- Lower setup complexity for nested structures
- Faster in benchmarks (1.5-3x across categories)
- MongoDB-style operators for complex updates
- Simpler mental model (everything reactive by default)

## When to Choose MobX

- Need selective observability to reduce memory in sparse scenarios
- Class-based state management preferred
- Team benefits from mature DevTools and debugging
- Deep nesting is limited or carefully controlled

## When to Choose Supergrain

- Complex nested state with automatic reactivity
- Performance-critical applications
- Teams preferring automatic optimization over explicit configuration
- Simpler setup without decorators or explicit observable declarations
