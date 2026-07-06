---
"@supergrain/mill": patch
---

Prototype fidelity: mill no longer imposes `Object.prototype` on documents that don't use it.

- Undo snapshots are now taken with a prototype-faithful clone instead of `structuredClone`, which silently normalized every object to `Object.prototype` — so rewinding an update on a null-prototype document corrupted its flavor. Snapshots now restore the prior state exactly, prototype included (shared references within a snapshot are preserved; Dates still clone as Dates).
- Intermediate branches fabricated by a deep `$set`/`$inc`/... on a missing path now match the document's flavor (a null-prototype document grows null-prototype branches) instead of hardcoding `{}`.

Mill remains reference-semantics for values: `$set`/`$push`/`$addToSet` still store exactly the objects you pass, no copying.
