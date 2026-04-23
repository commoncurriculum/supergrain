# Notes

Project documentation, research findings, and design decisions for Supergrain.

## Start Here

- [Compiled Reads Investigation](performance/compiled-reads-investigation.md) -- Full story of achieving solid-js performance: proxy → createView → $$() direct DOM
- [Core Store Optimization](performance/core-store-optimization.md) -- How reactive reads went from 5,878x slower to 1.5x overhead

## Architecture

- [Proxy Optimization Trade-offs](architecture/proxy-optimization-trade-offs.md) -- Active design decisions in the proxy handler
- [React Adapter Architecture](architecture/react-adapter-architecture.md) -- Proposed vs shipped React integration design
- [Safe Compile-Time Optimizations](architecture/safe-compile-time-optimizations.md) -- Unimplemented compile-time ideas
- [Vite Compiler Plugin](architecture/vite-compiler-plugin-plan.md) -- Original plan (readSignal abandoned; createView + $$() shipped)
- [Silo Architecture](architecture/silo-architecture.md) -- Design spec for `@supergrain/silo` (document-store read layer)

## Benchmarks

- [Findings Summary](benchmarks/findings-summary.md) -- Primary reference for all performance data
- [Direct Mutation Breakthrough](benchmarks/direct-mutation-breakthrough.md) -- 6x improvement via direct proxy setter
- [Proxy Overhead Analysis](benchmarks/proxy-overhead-analysis.md) -- 50x-990x overhead breakdown by operation
- [Proxy Overhead Benchmark](benchmarks/proxy-overhead-benchmark.md) -- Benchmark code for proxy measurements
- [Performance Analysis](benchmarks/performance-analysis.md) -- Corrected benchmark methodology (createComputed vs createEffect bug)
- [Results](benchmarks/results.md) -- Proxy vs direct signal access (2-15x faster)

Micro-analyses: [forEach](benchmarks/foreach-analysis.md) | [isEqual Threshold](benchmarks/isEqual-threshold-analysis.md) | [Allocation](benchmarks/allocation-analysis-benchmark.md) | [Signal Pooling](benchmarks/signal-pooling.md) | [Safe Optimizations](benchmarks/safe-optimizations-benchmark.md) | [Reactivity Validation](benchmarks/reactivity-validation-tests.md)

Results data: [Core vs Solid](benchmarks/results/core-comparison.md) | [State Libraries](benchmarks/results/state-libraries.md) | [Row Operations](benchmarks/results/row-operations.md) | [Additional](benchmarks/results/additional.md)

How to run: [Running Benchmarks](benchmarks/running-benchmarks.md) | [Krausest Setup](benchmarks/krausest-setup.md)

## Comparisons

[Ember](comparisons/ember.md) | [Jotai](comparisons/jotai.md) | [MobX](comparisons/mobx.md) | [Reactively](comparisons/reactively.md) | [Redux Toolkit](comparisons/redux-toolkit.md) | [RxJS](comparisons/rxjs.md) | [Solid](comparisons/solid.md) | [Supergrain (self)](comparisons/supergrain.md) | [Valtio](comparisons/valtio.md) | [Zustand](comparisons/zustand.md) | [Reactive Techniques](comparisons/reactive-techniques.md)

## React Adapter

- [useTracked](react-adapter/useTracked.md) -- **Superseded by `tracked()`.** Original React integration hook (see `tracked()` in `@supergrain/kernel/react`)
- Evolution: [v2](react-adapter/v2-initial-design.md) → [v3](react-adapter/v3-tracking-discovery.md) → [v4](react-adapter/v4-nested-components.md) → [useTracked](react-adapter/useTracked.md)

## Performance

- [Core Store Optimization](performance/core-store-optimization.md) -- Phases 1-4 complete (5,878x → 1.5x overhead)
- [Compiled Reads Investigation](performance/compiled-reads-investigation.md) -- The $$() direct DOM journey
- [Proxy Reference Stability Issue](performance/proxy-reference-stability-issue.md) -- 50x fix via global proxy caching
- [Reconciliation Optimization](performance/reconciliation-optimization.md) -- Planned investigation
- [Signal Infrastructure Optimizations](performance/signal-infrastructure-optimizations.md) -- WeakMap recommended, inline rejected
- [Structurae Evaluation](performance/structurae-evaluation.md) -- External data structures evaluated, none applicable

## Publishing

[NPM Checklist](publishing/npm-checklist.md) | [NPM Setup](publishing/npm-setup.md) | [Releasing](publishing/releasing.md)

## Failed Approaches

Don't retry these. Each doc explains what was tried and why it failed.

**React integration (7 failed attempts):**
[React Tracking Approaches](failed-approaches/react-tracking-approaches.md)

**Compiled reads / signal optimization:**
[readSignal Function Calls](failed-approaches/readSignal-function-call.md) |
[Per-level Compilation](failed-approaches/per-level-readSignal-compilation.md) |
[Preact Signals Comparison](failed-approaches/preact-signals-comparison.md) |
[Nested Effect Creation](failed-approaches/nested-effect-creation.md) |
[Eager Pre-allocation](failed-approaches/eager-signal-preallocation.md)

**Component / rendering optimization:**
[For Component](failed-approaches/for-component-investigation.md) |
[React Performance Attempts](failed-approaches/react-performance-optimization-attempts.md) |
[JS Framework Benchmark Attempts](failed-approaches/js-framework-benchmark-optimization-attempts.md)

**Store internals:**
[Context Switching](failed-approaches/context-switching-optimization.md) |
[Inline Primitive Checks](failed-approaches/inline-primitive-checks-optimization.md) |
[Reactivity-Breaking](failed-approaches/reactivity-breaking-optimizations.md) |
[Signal Prototype](failed-approaches/signal-prototype-optimization.md) |
[WeakMap Node Storage](failed-approaches/weakmap-node-storage-optimization.md)
