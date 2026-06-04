---
"@supergrain/queries": minor
"@supergrain/silo": minor
---

Run `@supergrain/queries` on the **same Effect engine** as the store, so a query
fetch behaves exactly like a silo document fetch instead of feeling like a
separate package.

**Shared engine.** silo now exports `runAdapter` — the single entrypoint that
turns one adapter call into a typed, resilient, abortable Effect (Promise→
`AdapterError` boundary, per-attempt `AbortController`, `retry`, `timeout`).
The store's finder and `createQuery` both go through it, so resilience and abort
behave identically on both surfaces.

**`createQuery` is now Promise-first with a signal.** `QueryAdapter.fetch(id, {
offset, limit, signal })` — return a `Promise` (a rejection becomes an
`AdapterError`) or an `Effect`. `signal` aborts when the run is interrupted (a
`timeout` fires, a `retry` abandons the prior attempt, or the query is destroyed
/ superseded), exactly like a silo `DocumentAdapter`.

**Breaking — resilience config matches `ModelConfig`.**

- `backoff?: (attempt) => number` is **removed**. Pass `retry?:
Schedule.Schedule<unknown, AdapterError>` and `timeout?: Duration.DurationInput`
  instead — the same knobs as `ModelConfig.retry` / `ModelConfig.timeout`.
- **There is no built-in auto-retry anymore.** Like a silo document fetch, a
  failure settles `error` immediately unless you opt into `retry`. (The old
  default fibonacci backoff retried forever; `fibonacciBackoff` is removed.)
- `Query.error` is now typed `SiloError | undefined` (was `Error | undefined`).

**Single-flight.** Starting a new `refetch()` / `fetchNextPage()` (or
`destroy()`) interrupts any in-flight fetch — its adapter `signal` aborts — so
overlapping requests can't race to write the store.

```diff
- createQuery({ store, adapter, type, id, backoff: (n) => n * 1000 });
+ createQuery({ store, adapter, type, id, retry: Schedule.exponential("1 second") });
```

`effect` is a peer dependency (installed; you don't have to write Effect).
