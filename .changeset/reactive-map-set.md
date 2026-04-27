---
"@supergrain/kernel": minor
---

Add reactive Map and Set support.

`createReactive()` now accepts `Map` and `Set` values (as root state or as nested values). Reads (`get`, `has`, `size`, iteration) are tracked per-key; writes (`set`, `delete`, `add`, `clear`) notify only the affected subscribers.

`@supergrain/silo` bucket storage is migrated from `Record<string, …>` to `Map` to use the new reactive collection support.
