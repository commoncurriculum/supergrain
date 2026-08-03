---
"@supergrain/mill": patch
---

Fix `update()` generating an unreplayable `undo` when one path's inverse covers
another's — replaying it threw `Update would create a conflict between paths
"…" and "…"`. Two shapes were affected:

- Several paths writing under a branch the update itself creates
  (`{ $set: { "rel.course": …, "rel.planbook": … } }` with no `rel`): the first
  path's undo restores the whole missing branch, so later entries under it are
  redundant and are no longer recorded.
- Index writes on one array both in and out of bounds
  (`{ $set: { "arr.2": …, "arr.5": … } }` on a 3-element array): the
  out-of-bounds write's whole-array restore now absorbs the entries already
  recorded beneath it — reconstructing the pristine array — instead of
  conflicting with them. A granular array inverse whose path runs through an
  ancestor array is recorded as that array's whole restore, so absorption
  always suffices.

Also fixes a MongoDB divergence: `$set` through a non-index field on an array
(`{ $set: { "b.c": 1 } }` where `b` is an array) now throws
`Cannot create field 'c' in element {b: […]}.` like real MongoDB, instead of
setting a string key on the array.
