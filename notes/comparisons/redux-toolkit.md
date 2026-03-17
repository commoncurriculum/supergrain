# Redux Toolkit Comparison

> **Status:** Reference analysis. Redux Toolkit (RTK) is the most widely adopted React state manager, with fundamentally different architecture (immutable actions/reducers).
>
> **Key difference:** RTK uses immutable state with explicit actions and Immer; Supergrain uses mutable proxies with automatic reactivity. RTK has the highest memory footprint but the best debugging tools.

## Architecture

| Aspect | Redux Toolkit | Supergrain |
|--------|---------------|-----------|
| Update Model | Immutable actions/reducers | Mutable proxy operations |
| Change Detection | Reference equality | Proxy trap execution |
| State Structure | Immutable object trees | Mutable proxy objects |
| Batching | Manual via `batch()` | Automatic via signals |
| Bundle Size | ~23KB | ~5KB + alien-signals |
| Re-render Control | Explicit selectors | Automatic access tracking |

## Memory Comparison

| Component | Redux Toolkit | Supergrain |
|-----------|---------------|-----------|
| Base store | ~1-2KB (store + middleware + enhancers) | ~200 bytes |
| Per update | ~100 bytes (action object) + new state tree | ~50 bytes temp (in-place) |
| DevTools | 1MB+ in development | N/A |
| After 1,000 updates | ~102KB+ (with action history) | ~200 bytes |

RTK has the highest memory footprint among compared libraries due to action objects, immutable state trees, and DevTools history.

**Deep nesting (6 levels, 100 updates):**

| Library | After 100 Updates | GC Pressure |
|---------|-------------------|-------------|
| Redux Toolkit | ~114KB+ (with history) | Very High |
| Supergrain | ~1.25KB | Very Low |

## Performance Comparison

| Operation | Redux Toolkit | Supergrain | Notes |
|-----------|---------------|-----------|-------|
| Store setup | ~9-20ms | ~1.3ms | RTK 5-10x slower (middleware, DevTools) |
| Simple reads | ~0.011ms | ~0.08ms | RTK ~7x faster (plain objects) |
| Deep reads | ~0.011ms | ~0.13ms | RTK ~10x faster (no proxy) |
| Simple updates | ~0.6ms (prod) | ~0.5ms | Similar |
| Complex nested updates | ~6-13ms | ~1.5ms | Supergrain 3-8x faster |
| Development overhead | ~4ms (DevTools) | None | RTK much heavier in dev |

RTK reads are fast because `useSelector` accesses plain objects. But updates are expensive due to Immer draft creation, immutable tree generation, and middleware traversal.

## Key Differences

**RTK advantages:**
- Best-in-class debugging (time travel, action replay, state inspection)
- Predictable state flow (action -> reducer -> state)
- Mature middleware ecosystem
- Battle-tested patterns for large applications
- Fast reads (plain object access)

**RTK disadvantages:**
- High memory overhead (action history, Immer drafts)
- Complex nested updates (~6-13ms with Immer)
- Verbose boilerplate for deep state changes
- DevTools can consume 10MB+ in long sessions

**Supergrain advantages:**
- In-place mutations (no immutable overhead)
- Automatic fine-grained reactivity (no selectors needed)
- Consistent memory footprint (no action history accumulation)
- 3-8x faster for complex nested updates
- Same memory characteristics in dev and production

## When to Choose RTK

- Large teams needing audit trails and action replay
- Applications requiring extensive debugging capabilities
- Infrequent state updates where memory overhead is acceptable
- Existing Redux codebases

## When to Choose Supergrain

- Frequent deep state updates
- Memory-constrained environments
- Automatic reactivity preferred over manual selectors
- Simpler state management without action/reducer boilerplate
