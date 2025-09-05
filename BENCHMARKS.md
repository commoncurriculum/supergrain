# Benchmarks

Performance benchmarking for `@storable/core` with a focus on comparing against `solid-js/store`.

## Quick Start

To run the core benchmarks for rapid iteration during development:

```bash
cd packages/core
pnpm bench:core
```

This runs only the essential benchmarks that directly compare `@storable/core` with `solid-js/store` and completes in under 30 seconds.

## Benchmark Organization

The benchmarks are organized into two main categories:

### 1. Core Benchmarks (`core-comparison.bench.ts`)

**Purpose**: Quick validation during development
**Runtime**: ~30 seconds
**Command**: `pnpm bench:core`

Essential tests covering:

- Store creation performance
- Property access (reactive and non-reactive)
- Property updates with effects
- Array operations
- Deep nesting performance
- Real-world todo app scenario
- MongoDB operators vs direct mutations
- Effect management
- Complex object updates

All core benchmarks include **reactive context validation** to ensure effects are properly tracking dependencies and the benchmarks are testing actual reactive behavior.

### 2. Additional Benchmarks (`additional.bench.ts`)

**Purpose**: Detailed performance analysis
**Runtime**: 1-2 minutes
**Command**: `pnpm bench:additional`

Comprehensive tests covering:

- Proxy overhead analysis
- Memory patterns and GC behavior
- Internal signal characteristics
- Detailed MongoDB operator performance
- Depth impact analysis (up to 10 levels)
- Array method performance
- Complex use cases (forms, data grids, shopping carts, recursive trees)
- Batch update patterns
- Edge cases (circular references, symbol properties)

## Running Benchmarks

```bash
# Navigate to the core package
cd packages/core

# Run core benchmarks only (fastest, for development)
pnpm bench:core

# Run all benchmarks
pnpm bench:all

# Run additional/detailed benchmarks only
pnpm bench:additional
```

## When to Run Which Benchmarks

### During Active Development

Use `pnpm bench:core` when:

- Making changes to proxy implementation
- Optimizing reactive tracking
- Modifying array handling
- Working on setter functions
- Testing new features

### Before Commits/PRs

Use `pnpm bench:all` when:

- About to commit significant changes
- Creating a pull request
- Doing dedicated performance optimization
- Need comprehensive performance data

### Performance Investigation

Use `pnpm bench:additional` when:

- Investigating specific performance issues
- Analyzing memory usage patterns
- Understanding proxy overhead
- Optimizing for specific use cases

## Performance Targets

Our goals relative to `solid-js/store`:

| Operation        | Target      | Acceptable |
| ---------------- | ----------- | ---------- |
| Store creation   | Within 1.5x | Within 2x  |
| Property access  | Within 2x   | Within 3x  |
| Property updates | Within 2x   | Within 3x  |
| Array operations | Within 3x   | Within 4x  |
| Memory usage     | Within 1.5x | Within 2x  |

## Interpreting Results

Vitest bench provides:

- **ops/sec**: Operations per second (higher is better)
- **± %**: Standard deviation percentage (lower is more consistent)
- **Relative performance**: Comparison between implementations

### What to Look For

1. **Relative Performance**: Compare `@storable/core` vs `solid-js/store`
2. **Consistency**: Low standard deviation indicates predictable performance
3. **Scaling**: Performance should degrade linearly with data size
4. **Memory**: Watch for memory leaks in create/dispose cycles

### Red Flags

- Performance > 5x slower than solid-js
- High standard deviation (> 10%)
- Non-linear performance degradation
- Memory not being freed after dispose

## Reactive Context Validation

Both benchmark files include reactive context validation that:

1. Verifies effects are properly tracking dependencies
2. Ensures updates trigger effect re-runs
3. Prevents false benchmark results from non-reactive code

If reactive tracking fails, benchmarks will throw an error immediately with a descriptive message.

Example validation:

```typescript
bench('@storable/core: reactive test', () => {
  const [store] = createStore({ value: 0 })
  let effectRuns = 0

  const dispose = effect(() => {
    effectRuns++
    const _ = store.value
  })

  // Verify effect ran initially
  if (effectRuns === 0) {
    throw new Error('Effect did not run during reactive test')
  }

  // Perform benchmark operations...

  dispose()
})
```

## Adding New Benchmarks

When adding benchmarks:

1. **Decide on placement**:
   - Core comparison? → Add to `core-comparison.bench.ts`
   - Detailed analysis? → Add to `additional.bench.ts`

2. **Include comparisons**:
   - Always include `@storable/core` version
   - Always include `solid-js/store` version
   - Consider adding plain JavaScript baseline

3. **Add reactive validation**:
   - Verify effects run when expected
   - Check that dependencies are tracked
   - Ensure updates trigger re-runs

4. **Use realistic scenarios**:
   - Real-world data sizes
   - Common usage patterns
   - Edge cases that matter

5. **Document the test**:
   - What is being measured
   - Why it matters
   - Expected results

## System Requirements

- Node.js 18+ recommended
- 8GB RAM minimum
- Close other applications for consistent results
- Run on consistent hardware when comparing across commits

## Tips for Accurate Results

1. **Warm up**: Run benchmarks twice, use second results
2. **Isolation**: Close unnecessary applications
3. **Consistency**: Use same Node version across comparisons
4. **Multiple runs**: Run 3 times and average if critical
5. **Environment**: Disable CPU throttling if possible

## Continuous Integration

For CI environments, use only core benchmarks:

```bash
pnpm bench:core
```

This ensures quick feedback while still catching major performance regressions.

## Benchmark Files

- **`core-comparison.bench.ts`**: Essential benchmarks with solid-js comparison (~30s runtime)
- **`additional.bench.ts`**: Detailed performance analysis (1-2min runtime)

Both files include comprehensive reactive context validation to ensure accurate results.
