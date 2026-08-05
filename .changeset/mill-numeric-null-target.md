---
"@supergrain/mill": patch
---

Fix `allowNullIntermediates` so a `null` _target_ of a numeric operator counts as absent.

`allowNullIntermediates` is documented as treating a `null` intermediate **or target** as if the field were absent, but the numeric operators only honored that for intermediates: `$inc`-ing a `null` field still threw `$inc path "attributes._revision" must point to a number, received null.` even with the option on. That defeats the option's purpose — it exists so patches that work against MongoDB (where the field is genuinely absent) also work against documents where the absent field arrived as `null`.

With `allowNullIntermediates: true`, a `null` target is now treated as a missing field:

- `$inc` starts from 0, so `{ a: null }` + `$inc: { a: 1 }` yields `{ a: 1 }`.
- `$mul` starts from 0, yielding `0`.
- `$min` / `$max` take the operand instead of keeping the `null`.

Default behavior is unchanged: with the option off, `$inc` / `$mul` still reject a `null` target, and `$min` / `$max` still compare against it as a value sorting below every number — exactly as MongoDB does. The generated `undo` restores the prior `null`.
