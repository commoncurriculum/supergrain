---
"@supergrain/core": minor
"@supergrain/react": minor
"@supergrain/store": minor
---

### Performance

- **O(1) row selection** — Moved `isSelected` from a computed comparison (`selected === item.id`) to a boolean property signal on each row item. Select now flips two booleans instead of re-evaluating every row, eliminating the O(n) scan.
- **Skip signal reads without active subscriber** — When no tracking context exists (`getCurrentSub()` is null), property reads short-circuit past signal creation and return the raw value directly. Zero-cost reads outside reactive contexts.
- **flushSync for select** — Wrapped the select handler in `flushSync` for synchronous DOM commits, matching Krause benchmark measurement.

### New Features

- **Signal profiler** — New opt-in profiler for diagnosing signal behavior. Tracks reads, writes, skipped reads, and effect runs. Zero cost when disabled. New exports: `enableProfiling`, `disableProfiling`, `getProfile`, `resetProfiler`.

### Breaking Changes

- **Typed/schema API removed** — Deleted `createModelView`, `SchemaLike`, `attachViewNodes`, and the `createStore(state, schema)` overload. The typed layer and all associated benchmarks/tests have been removed.
