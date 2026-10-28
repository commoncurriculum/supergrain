---
"@supergrain/devtools": patch
"@supergrain/mill": patch
"@supergrain/silo": patch
---

Fix two defects surfaced by new fast-check property suites, plus one hardening.

**mill — `__proto__` path segments wrote to `Object.prototype`.** Path
navigation followed `__proto__` like any other segment, so
`$set: {"__proto__.x": 1}` walked off the document onto `Object.prototype` and
corrupted every object in the process. `__proto__` is now rejected as a path
segment by `splitPath`, alongside the existing empty-segment check. It is the
only inherited property of a plain object or array that holds an _object_ —
every other inherited member is a function, which the existing `isContainer`
guard already refuses to step into — so no other segment needed handling and
the navigation loops are unchanged.

**devtools — `serialize()` crashed on values that throw when read.** A property
getter that throws, or a revoked proxy anywhere in a document, propagated out of
`serialize` and took the whole inspector panel down. Reads are now guarded
per-field and degrade to a new `unreadable` node, so one bad value costs its own
row and the rest of the document still renders.

**silo — `Retrying` applied to an already-ended fetch cycle.** A `Retrying`
event arriving after its cycle had settled bumped `failureCount` and moved
`lastError` past the terminal `error`. `Retrying` is now ignored when no fetch
is in flight, matching the precondition its own docstring states.
