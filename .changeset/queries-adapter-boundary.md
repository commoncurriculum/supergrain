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

**Errors go through the typed boundary.** A failed fetch is funneled through
`coerceAdapter`, so a rejected Promise (or failed Effect) becomes an
`AdapterError` with the original rejection on its `.cause`. `Query.error` stays
typed as `Error | undefined` (the widest honest type — an Effect adapter can
still die with a defect), but on the normal failure path the runtime value is
an `AdapterError`. Retry/backoff behavior is unchanged.

`effect` is a peer dependency (installed; you don't have to write Effect).
