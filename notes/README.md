# Notes

All project documentation lives here.

## Start Here

- [Compiled Reads Investigation](research/compiled-reads-investigation.md) — Full story of achieving solid-js performance in React
- [Prior Conversation Findings](research/prior-conversation-findings.md) — Transcript locations and key findings

## Architecture

- [Solid Architecture](architecture/solid-architecture.md) — How solid-js achieves its performance
- [Proxy Optimization Trade-offs](architecture/proxy-optimization-trade-offs.md)
- [React Adapter Architecture](architecture/react-adapter-architecture.md)
- [Ember Analysis](architecture/ember-analysis.md)
- [Safe Compile-Time Optimizations](architecture/safe-compile-time-optimizations.md)

## Research

- [Path to 10x](research/path-to-10x.md) — Original strategy (superseded by compiled-reads-investigation)
- [Prior Conversation Findings](research/prior-conversation-findings.md)

## Failed Approaches

Don't retry these:

**March 2026:**
[readSignal Function Calls](failed-approaches/readSignal-function-call.md) |
[Per-level Compilation](failed-approaches/per-level-readSignal-compilation.md) |
[Preact Signals](failed-approaches/preact-signals-comparison.md) |
[Nested Effect Creation](failed-approaches/nested-effect-creation.md) |
[Eager Pre-allocation](failed-approaches/eager-signal-preallocation.md)

**Earlier:**
[Context Switching](failed-approaches/context-switching-optimization.md) |
[Inline Primitive Checks](failed-approaches/inline-primitive-checks-optimization.md) |
[JS Framework Benchmark](failed-approaches/js-framework-benchmark-optimization-attempts.md) |
[React Performance](failed-approaches/react-performance-optimization-attempts.md) |
[Reactivity-Breaking](failed-approaches/reactivity-breaking-optimizations.md) |
[Signal Prototype](failed-approaches/signal-prototype-optimization.md) |
[WeakMap Node Storage](failed-approaches/weakmap-node-storage-optimization.md)

## Comparisons

[Zustand](comparisons/zustand.md) | [Jotai](comparisons/jotai.md) | [Valtio](comparisons/valtio.md) | [MobX](comparisons/mobx.md) | [RxJS](comparisons/rxjs.md) | [Reactively](comparisons/reactively.md) | [Redux Toolkit](comparisons/redux-toolkit.md) | [Storable](comparisons/storable.md) | [Techniques](comparisons/techniques.md)

## Benchmarks

- [Proxy Overhead Analysis](benchmarks/proxy-overhead-analysis.md) | [Summary](benchmarks/proxy-overhead-summary.md)
- [Consolidated Findings](benchmarks/consolidated-findings.md) | [Performance Analysis](benchmarks/performance-analysis.md)
- [Direct Mutation Breakthrough](benchmarks/direct-mutation-breakthrough.md)

Results: [Core vs Solid](benchmarks/results/core-comparison.md) | [State Libraries](benchmarks/results/state-libraries.md) | [Additional](benchmarks/results/additional.md) | [Row Operations](benchmarks/results/row-operations.md)

## Planning

- [Vite Compiler Plugin](planning/vite-compiler-plugin-plan.md) — Original plan (readSignal abandoned; createView + $$() shipped)
- [Main Plan](planning/main-plan.md) | [Perf v1](planning/performance-plan-v1.md) | [Perf v2](planning/performance-plan-v2.md)
- [App Store](planning/app-store-plan.md) | [For Component](planning/for-component-investigation.md) | [Reconciliation](planning/reconciliation-optimization.md)

## React Adapter

[v2](react-adapter/v2-initial-design.md) → [v3](react-adapter/v3-tracking-discovery.md) → [v4](react-adapter/v4-nested-components.md) → [v5 Final](react-adapter/v5-final.md) | [Nested Solution](react-adapter/nested-components-solution.md)

## Publishing

[NPM Checklist](publishing/npm-checklist.md) | [NPM Setup](publishing/npm-setup.md) | [Releasing](publishing/releasing.md)
