---
"@supergrain/oxlint-plugin": minor
---

New package: `@supergrain/oxlint-plugin`, oxlint rules for supergrain code that type-checks, renders, and is silently non-reactive. `require-tracked` reports React components not wrapped in `tracked()`; `no-async-batch` reports an async callback passed to `batch()`, which throws at runtime. Both identify supergrain by its imports, and an `importSources` option covers a project barrel that re-exports it.
