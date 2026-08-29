---
"@supergrain/devtools": patch
"@supergrain/mill": patch
"@supergrain/silo": patch
---

Fix three defects surfaced by new fast-check property suites.

**mill — prototype-chain navigation in dotted paths.** Path segments were
resolved with plain `container[segment]`, which walks the JS prototype chain.
`$set` on `"constructor.prototype.x"` therefore reached `Object.prototype` and
polluted every object in the process, and `"__proto__.x"` reassigned the
document's prototype instead of writing a field — silently dropping the update.
Navigation now sees own properties only, and a literal `__proto__` field is
written as an own data property. Both match what real MongoDB stores, as
verified by the package's mongod oracle.

**devtools — `serialize()` crashed on values that throw when read.** A property
getter that throws, or a revoked proxy anywhere in a document, propagated out of
`serialize` and took the whole inspector panel down. Reads are now guarded
per-field and degrade to a new `unreadable` node, so one bad value costs its own
row and the rest of the document still renders.

**silo — `Retrying` applied to an already-ended fetch cycle.** A `Retrying`
event arriving after its cycle had settled bumped `failureCount` and moved
`lastError` past the terminal `error`. `Retrying` is now ignored when no fetch
is in flight, so the handle's invariants hold regardless of emitter ordering.
