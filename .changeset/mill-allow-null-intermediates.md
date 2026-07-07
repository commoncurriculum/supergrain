---
"@supergrain/mill": minor
---

Add an `allowNullIntermediates` option to `update()`.

By default mill stays faithful to MongoDB and rejects writing through a `null` (e.g. `$set`-ing `"a.b"` when `a` is `null` throws `Cannot create field 'b' in element {a: null}`). Pass `allowNullIntermediates: true` to instead treat a `null` intermediate or target as if the field were absent:

- `$set` / `$inc` / `$mul` / `$min` / `$max` / `$rename` build objects over `null` intermediates.
- `$push` / `$addToSet` create the array when the target (or an intermediate) is `null`.
- `$pull` / `$pullAll` / `$pop` no-op on a `null` target, exactly as they do for a missing field.

A present scalar in the way is still an error — only `null` is treated as absent — and the generated `undo` restores the prior `null` exactly.
