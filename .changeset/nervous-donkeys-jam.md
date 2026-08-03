---
"@supergrain/mill": patch
---

Fix `update()` generating an unreplayable `undo` when several paths write under a
branch the update itself has to create.

`{ $set: { "rel.course": …, "rel.planbook": … } }` on a document with no `rel`
captured `$unset: { rel: "" }` for the first path — which creates `rel` — and then
`$unset: { "rel.planbook": "" }` for the second, which now finds it. Replaying that
undo threw `Update would create a conflict between paths "rel" and "rel.planbook"`.
The shallower entry already restores the whole subtree, so entries an existing one
covers are no longer recorded.
