# Benchmarks

This directory contains performance benchmarks comparing `@storable/core` with `solid-js/store` and analyzing internal performance characteristics.

## Quick Start

Run the core benchmarks for rapid iteration during development:

```bash
pnpm bench:core
```

This runs only the essential benchmarks that directly compare `@storable/core` with `solid-js/store`.

## Benchmark Structure

### Core Benchmarks (`core-comparison.bench.ts`)

Essential performance tests that should be run frequently during development:

- **Store Creation**: Comparing store initialization performance
- **Property Access**: Both reactive and non-reactive reads
- **Property Updates**: Single and batch updates with effects
- **Array Operations**: Push, splice, and reactive tracking
- **Deep Nesting**: Performance with deeply nested objects
- **Real-World Todo App**: Practical application scenario
- **MongoDB Operators**: Comparing operators vs direct mutations
- **Effect Management**: Creating, tracking, and disposing effects
- **Complex Object Updates**: Nested object array mutations

**Key Features:**

- Reactive context validation to ensure effects are actually tracking
- Direct comparison with solid-js/store
- Completes in ~30 seconds
- Tests include verification that reactive contexts are working

### Additional Benchmarks (`additional.bench.ts`)

Detailed performance analysis for deeper insights:

- **Proxy Overhead Analysis**: Raw proxy vs plain object comparison
- **Memory Patterns**: Memory usage and garbage collection patterns
- **Internal Characteristics**: Signal creation and caching behavior
- **MongoDB Operators Detailed**: Comprehensive operator testing
- **Depth Impact Analysis**: Performance across different nesting levels
- **Array Method Performance**: Non-mutating array operations
- **Complex Use Cases**: Form state, data grid, shopping cart, recursive trees
- **Batch Update Patterns**: Various update strategies
- **Edge Cases**: Circular references, symbol properties

## Available Scripts

```bash
# Run only core benchmarks (fastest, for development)
pnpm bench:core

# Run all benchmarks
pnpm bench:all

# Run only additional/detailed benchmarks
pnpm bench:additional

# Run all benchmarks (legacy command)
pnpm bench
```

## When to Run Which Benchmarks

### During Development (`pnpm bench:core`)

Run the core benchmarks when:

- Making changes to the proxy implementation
- Optimizing reactive tracking
- Modifying array handling
- Working on the setter functions
- Implementing new features

### Before Commits (`pnpm bench:all`)

Run all benchmarks when:

- About to commit significant changes
- Creating a pull request
- Doing performance optimization work
- Need comprehensive performance data

### Deep Analysis (`pnpm bench:additional`)

Run additional benchmarks when:

- Investigating specific performance issues
- Analyzing memory usage patterns
- Understanding proxy overhead
- Optimizing for specific use cases

## Reactive Context Validation

Both benchmark files include reactive context validation to ensure that:

1. Effects are properly tracking dependencies
2. Updates trigger effect re-runs
3. The benchmarks are testing actual reactive behavior

If reactive tracking fails, the benchmarks will throw an error immediately, preventing false results.

## Interpreting Results

The benchmarks use Vitest's bench feature, which provides:

- Operations per second (higher is better)
- Relative performance comparisons
- Standard deviation and variance

Key metrics to watch:

1. **Relative performance vs solid-js**: Should be within 2x for most operations
2. **Consistency**: Low standard deviation indicates predictable performance
3. **Scaling**: Performance should scale linearly with data size

## Adding New Benchmarks

When adding new benchmarks:

1. **Core benchmarks**: Add to `core-comparison.bench.ts` if it's essential for validating changes
2. **Additional benchmarks**: Add to `additional.bench.ts` if it's for detailed analysis
3. Always include both `@storable/core` and `solid-js/store` versions for comparison
4. Add reactive context validation for any benchmark testing reactive behavior
5. Use realistic data sizes and patterns
6. Include a baseline (plain JavaScript) when measuring overhead

Example of adding a reactive benchmark with validation:

```typescript
bench('my reactive test', () => {
  const [store] = createStore({ value: 0 })
  let effectRuns = 0

  const dispose = effect(() => {
    effectRuns++
    const _ = store.value
  })

  // Verify effect ran initially
  if (effectRuns === 0) {
    throw new Error('Effect did not run')
  }

  // Do benchmark work...

  dispose()
})
```

## Performance Goals

Our performance targets relative to solid-js/store:

- **Store creation**: Within 1.5x
- **Property access**: Within 2x
- **Property updates**: Within 2x
- **Array operations**: Within 3x (due to fine-grained reactivity)
- **Memory usage**: Within 1.5x

## Notes

- The core benchmarks are designed to complete in under 30 seconds
- Additional benchmarks may take 1-2 minutes to complete
- Results can vary based on system load and Node.js version
- Use Node.js 18+ for best results
- All benchmarks include reactive context validation to prevent false results
