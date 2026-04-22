---
"@supergrain/kernel": major
"@supergrain/mill": major
"@supergrain/silo": major
---

Ship `@supergrain/silo` and rename core packages.

- **`@supergrain/core` → `@supergrain/kernel`.** The reactive primitives package is renamed. Imports become `@supergrain/kernel` for the core and `@supergrain/kernel/react` for the React subpath.
- **`@supergrain/operators` → `@supergrain/mill`.** The MongoDB-style update operator package is renamed. Imports become `@supergrain/mill`.
- **New: `@supergrain/silo`.** A Suspense-compatible document store with first-class request batching. `createDocumentStore(config)` builds the plain store; `createDocumentStoreContext()` (from `@supergrain/silo/react`) returns a Provider + hooks. Batches `useDocument` calls within a configurable window (default 15ms) into single `adapter.find(ids)` requests. Ships `defaultProcessor`, `defaultQueryProcessor`, and `jsonApiProcessor` plus JSON-API relationship hooks (`useBelongsTo`, `useHasMany`, `useHasManyIndividually`).
- **Types-from-source.** Every `exports[*].types` entry in kernel and silo points at `src/*.ts` so fresh clones typecheck without a prior build. Published tarballs now ship `src/` alongside `dist/`. Kernel's hand-maintained `internal.d.ts` is removed.
