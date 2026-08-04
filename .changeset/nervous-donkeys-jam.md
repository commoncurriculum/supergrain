---
"@supergrain/mill": patch
---

Fix `update()` generating an unreplayable `undo` when one path's inverse
covered another's — replaying it threw `Update would create a conflict between
paths "…" and "…"`. This hit updates writing several paths under a branch the
update itself creates (`{ $set: { "rel.course": …, "rel.planbook": … } }` with
no `rel`) and index writes on one array both in and out of bounds.

Undo is no longer recorded op by op while the update runs. `update()` now
plans, from the update document and the untouched document, the cheapest saved
state that suffices per path — the value a write overwrites, an absence marker
for a created branch, or just an array's length for appends and past-the-end
growth — applies the update, and derives the undo by comparing each saved spot
against the result. All planning happens before any mutation, and spots are
kept non-nested, so conflicting undo paths cannot be produced. Appending to an
array of any size plans O(1) undo work, and some undo documents get finer
(growing an array now undoes with a truncation instead of restoring the whole
prior array; edits to arrays nested inside arrays restore precisely).

Also fixes a MongoDB divergence: `$set` through a non-index field on an array
(`{ $set: { "b.c": 1 } }` where `b` is an array) now throws
`Cannot create field 'c' in element {b: […]}.` like real MongoDB, instead of
setting a string key on the array.
