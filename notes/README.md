# Supergrain Notes

## Start Here

- **[Compiled Reads Investigation](research/compiled-reads-investigation.md)** -- Full story of achieving solid-js performance in React. Covers every approach tried (readSignal, readLeaf, inline $NODE, createView, $$() direct DOM) with benchmark evidence for each.
- **[Path to 10x](research/path-to-10x.md)** -- Original strategy analysis: why solid is fast, the proxy fast-path optimization, and class getter view objects. Partially superseded by the investigation doc above.
- **[Prior Conversation Findings](research/prior-conversation-findings.md)** -- Transcript locations and key findings extracted from earlier Claude conversations.

## Architecture

- [Solid Architecture](architecture/solid-architecture.md) -- How solid-js achieves its performance
- [React Adapter Architecture](architecture/react-adapter-architecture.md) -- React adapter design
- [Ember Analysis](architecture/ember-analysis.md) -- Ember architecture analysis
- [Proxy Optimization Trade-offs](architecture/proxy-optimization-trade-offs.md) -- Proxy optimization analysis

## React Adapter Evolution

Chronological history of the React adapter:

1. [v2 Initial Design](react-adapter/v2-initial-design.md)
2. [v3 Tracking Discovery](react-adapter/v3-tracking-discovery.md) -- alien-signals dependency tracking
3. [v4 Nested Components](react-adapter/v4-nested-components.md) -- fixing parent/child tracking interference
4. [v5 Final](react-adapter/v5-final.md) -- proxy-based property access isolation
5. [Nested Components Solution](react-adapter/nested-components-solution.md) -- summary of the nested tracking fix

## Failed Approaches

Don't retry these -- they've been proven to not work:

### Compiled reads (March 2026)
- [readSignal Function Calls](failed-approaches/readSignal-function-call.md) -- V8 can't inline JS function calls; readSignal is slower than proxy
- [Per-level readSignal Compilation](failed-approaches/per-level-readSignal-compilation.md) -- Same work as proxy, wrap() dominates cost
- [Preact Signals Comparison](failed-approaches/preact-signals-comparison.md) -- Benchmarks were invalid (not run inside effect)
- [Nested Effect Creation](failed-approaches/nested-effect-creation.md) -- 5x overhead from creating effects inside running effects
- [Eager Signal Pre-allocation](failed-approaches/eager-signal-preallocation.md) -- Breaks on sub-tree replacement, wastes work
- [Inline Primitive Checks](failed-approaches/inline-primitive-checks-optimization.md) -- V8 already inlines wrap()/unwrap(); typeof checks add polymorphism

### Runtime optimizations (September 2025)
- [Context Switching Optimization](failed-approaches/context-switching-optimization.md) -- Reducing context switches in React hooks
- [Reactivity-Breaking Optimizations](failed-approaches/reactivity-breaking-optimizations.md) -- Fast-path caching that broke signal identity
- [Signal Prototype Optimization](failed-approaches/signal-prototype-optimization.md) -- Moving $ setter to prototype breaks identity
- [WeakMap Node Storage](failed-approaches/weakmap-node-storage-optimization.md) -- WeakMap for node storage: 12-46% regression

### React/benchmark optimizations (January 2025)
- [React Performance Optimization Attempts](failed-approaches/react-performance-optimization-attempts.md) -- Bypassing reconciliation failed to beat For component
- [JS Framework Benchmark Optimization](failed-approaches/js-framework-benchmark-optimization-attempts.md) -- React-hooks benchmark optimization attempts

## Planning

- [Vite Compiler Plugin Plan](planning/vite-compiler-plugin-plan.md) -- Original readSignal compilation plan (abandoned; createView + $$() shipped instead)
- [App Store Plan](planning/app-store-plan.md) -- Document-oriented app-level store design
- [For Component Investigation](planning/for-component-investigation.md) -- Investigation concluded: do not implement
- [Proxy Reference Stability Issue](planning/proxy-reference-stability-issue.md) -- Fixed: global proxy caching
- [Main Plan](planning/main-plan.md) -- Todo app feature testing plan
- [Performance Plan v1](planning/performance-plan-v1.md) / [v2](planning/performance-plan-v2.md) -- Earlier performance optimization plans
- [Reactively Takeaways](planning/reactively-takeaways.md) -- Lessons from reactively library
- [Reconciliation Optimization](planning/reconciliation-optimization.md) -- Reconciliation optimization ideas
- [Signal Infrastructure Optimizations](planning/signal-infrastructure-optimizations.md) -- Signal infra optimization ideas

## Benchmarks

- [Benchmarks README](benchmarks/README.md) -- Index of benchmark docs
- [Direct Mutation Breakthrough](benchmarks/direct-mutation-breakthrough.md) -- 6x improvement from enabling proxy setter
- [Consolidated Findings](benchmarks/consolidated-findings.md) -- Complete performance journey
- [Performance Analysis](benchmarks/performance-analysis.md) -- Corrected benchmark methodology
- [Analysis](benchmarks/analysis.md) / [Results](benchmarks/results.md) -- General benchmark data
- [Allocation Analysis](benchmarks/allocation-analysis-benchmark.md) -- Memory allocation hotspots
- [Proxy Overhead](benchmarks/proxy-overhead-benchmark.md) -- Raw proxy overhead numbers
- [ForEach Analysis](benchmarks/foreach-analysis.md) -- ForEach benchmark analysis
- [isEqual Threshold](benchmarks/isEqual-threshold-analysis.md) -- isEqual threshold analysis
- [JS Benchmark Plan](benchmarks/js-benchmark-plan.md) -- Benchmarking plan
- [Core Benchmarks](benchmarks/core-benchmarks-readme.md) -- Core benchmarks documentation
- [Reactivity Validation](benchmarks/reactivity-validation-tests.md) -- Reactivity validation tests
- [Safe Optimizations](benchmarks/safe-optimizations-benchmark.md) -- Safe optimization benchmarks

## Performance

- [Signal Pooling Benchmark](performance/signal-pooling-benchmark-code.md) -- Why signal pooling didn't help
- [Structurae Evaluation](performance/structurae-evaluation.md) / [Final Assessment](performance/structurae-final-assessment.md) -- @zandaqo/structurae evaluation

## Standalone Docs (root level)

- [Proxy Overhead Analysis](proxy-overhead-analysis.md) -- Detailed proxy overhead breakdown (188x-990x vs direct access)
- [Proxy Overhead Summary](PROXY_OVERHEAD_SUMMARY.md) -- Shorter summary of the above
- [Safe Compile-Time Optimizations](safe-compile-time-optimizations.md) -- Compile-time optimization strategies that preserve reactivity

## Benchmark Results (packages/core/benchmarks/)

These are in the core package alongside the benchmark code:

- `packages/core/benchmarks/CORE_COMPARISON.md` -- @supergrain/core vs solid-js/store
- `packages/core/benchmarks/STATE_LIBRARIES.md` -- vs zustand, jotai, valtio, mobx, preact/signals
- `packages/core/benchmarks/ROW_OPERATIONS.md` -- Table/list UI operation benchmarks
- `packages/core/benchmarks/ADDITIONAL.md` -- Proxy overhead, effect lifecycle, batch vs unbatched
