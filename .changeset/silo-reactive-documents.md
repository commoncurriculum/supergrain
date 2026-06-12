---
"@supergrain/silo": major
---

Stored documents and query results are now **live and reactive in place** — `insertDocument` / `insertQueryResult` no longer `Object.freeze` the value they store.

Silo sits on `@supergrain/kernel`'s fine-grained reactivity, but freezing the stored object opted it out of that graph: the kernel hands frozen targets back unwrapped, so reads off `handle.value` weren't tracked per field and in-place mutation was impossible. Removing the freeze restores the kernel's native behavior:

- **Mutate a field in place** — `handle.value.attributes.name = "Ada"` re-renders only the readers of that field.
- **Replace wholesale** — inserting a new object still re-renders whole-document readers, as before.
- No copy is made on insert; `unwrap(handle.value)` recovers the exact object you inserted.

**BREAKING CHANGE.** Two previously documented guarantees are gone:

- `handle.value` is now a **reactive proxy** of the stored object, not the raw object you passed to `insertDocument`. `handle.value === insertedDoc` no longer holds — use `unwrap(handle.value)` if you need the raw reference. (Proxy identity is still stable across reads, so memoizing on `handle.value` is unaffected.)
- Stored documents are **no longer frozen**. `Object.isFrozen(handle.value)` is now `false`, and a write that previously threw (top-level, strict mode) now succeeds and updates the cache reactively. If you want a document to stay immutable, freeze it yourself before inserting — but note that opts it out of per-field reactivity.
