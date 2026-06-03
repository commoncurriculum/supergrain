---
"@supergrain/queries": minor
---

Align the query adapter with `@supergrain/silo`'s Promise-first boundary.

**`QueryAdapter.fetch` is now Promise-first.** It returns
`Promise<QueryEnvelope<T>> | Effect.Effect<QueryEnvelope<T>, AdapterError>` —
**return a plain `Promise`** for the common case (a rejection becomes an
`AdapterError`, shared with silo's `coerceAdapter`), or **return an `Effect`**
to own the failure channel. Existing Promise-returning adapters keep working
as-is.

**Errors are now typed.** A failed fetch surfaces on `Query.error` as an
`AdapterError` (the original rejection is on its `.cause`) instead of the raw
thrown value. Retry/backoff behavior is unchanged.

`effect` is a peer dependency (installed; you don't have to write Effect).
