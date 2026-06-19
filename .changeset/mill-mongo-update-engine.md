---
"@supergrain/mill": major
---

Rewrite `@supergrain/mill` as a data-first MongoDB update engine.

`update(doc, query, operations, options?)` applies a standard MongoDB update document to `doc` in place and returns a serializable `undo` — itself a standard Mongo update document that reverses the exact changes made. There is no mill-specific syntax: every operator, modifier, query, and undo fragment is plain MongoDB.

- **Operators:** `$set`, `$unset`, `$inc`, `$mul`, `$min`, `$max`, `$rename`, `$push` (with `$each`/`$position`/`$slice`/`$sort`), `$pop`, `$pull` (full query conditions), `$pullAll`, `$addToSet`.
- **Positional updates:** `$`, `$[]`, and `$[<identifier>]` (driven by the `arrayFilters` option), with a Mongo-compatible query matcher.
- **Undo:** generated from the changes actually made — no-ops contribute nothing, prior state is restored exactly (including missing-vs-present), and array inverses use fine-grained Mongo operators where possible.
- **Behavior is pinned to real MongoDB:** every mutating test is replayed against an actual `mongod` and asserted to produce the identical document.

**Breaking:** the previous mill operator API is replaced by the new `update()` signature. mill no longer depends on `@supergrain/silo`, and `@supergrain/kernel` no longer depends on mill.
