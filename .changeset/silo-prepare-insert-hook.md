---
"@supergrain/silo": minor
---

Add an optional store-wide `hooks` config (parallel to `models` / `queries`) with two hooks that bracket **every** `insertDocument(type, doc)` — direct inserts, response-processor inserts (including JSON-API `included` sideloads), and Provider `initial` seeds — forming the pipeline `prepareInsert → insertDocument → afterInsert`. Cross-cutting insert behavior (shape migrations, defaulting, mirroring to another store) now lives in one place.

- **`prepareInsert(type, doc)`** normalizes on the way in. Following the response-processor `?? response` convention, returning nothing keeps the (possibly mutated) doc, returning a doc replaces it, and returning `null` vetoes the insert. Runs before the reactive proxy wraps a new doc.
- **`afterInsert(type, doc)`** observes the committed doc on the way out (for telemetry, mirrors, derived indexes). Its throws are isolated to the store's `onError` sink, and it does not run when `prepareInsert` vetoes.

See the silo README "Hooks" section for the full contract.
