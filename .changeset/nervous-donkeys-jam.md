---
"@supergrain/mill": patch
---

Fix `update()` generating an unreplayable `undo` when one path's inverse
covered another's — replaying it threw `Update would create a conflict between
paths "…" and "…"`. This hit updates writing several paths under a branch the
update itself creates (`{ $set: { "rel.course": …, "rel.planbook": … } }` with
no `rel`) and index writes on one array both in and out of bounds.

Undo is no longer recorded op by op while the update runs. `update()` now
copies the top-level fields its paths touch, applies the update, and derives
the undo by comparing the result against the copies — one walk that either
descends or emits at each spot, so conflicting undo paths cannot be produced.
Some undo documents get finer as a result (growing an array now undoes with a
truncation instead of restoring the whole prior array, and edits to arrays
nested inside arrays restore precisely).

Also fixes a MongoDB divergence: `$set` through a non-index field on an array
(`{ $set: { "b.c": 1 } }` where `b` is an array) now throws
`Cannot create field 'c' in element {b: […]}.` like real MongoDB, instead of
setting a string key on the array.
