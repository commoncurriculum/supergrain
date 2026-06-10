---
"@supergrain/queries": minor
"@supergrain/silo": minor
---

Run `@supergrain/queries` on the **same Effect engine** as the store, so a query
fetch behaves exactly like a silo document fetch instead of feeling like a
separate package.

**Shared engine.** silo now exposes `store.runAdapter(invoke, options)` — the
boundary that turns one adapter call into a typed, resilient, abortable Effect
(Promise→`AdapterError` boundary, per-attempt `AbortController`, `retry` /
`timeout` / `deadline`). It resolves per-call overrides over the store's
defaults, reports every failure to the store's `onError` sink, and counts
against the store's `maxConcurrency` — so a layered package's fetches behave
exactly like the finder's by construction. `createQuery` goes through it. (The
raw engine lives in `@supergrain/silo/internal` for tooling that needs it
without a store.)

**Shared default retry.** silo ships a built-in `defaultRetry` (jittered
fibonacci 1s–60s, retrying until success) and a store-wide
`DocumentStoreConfig.retry` / `timeout` / `deadline`. A document `find` and a
`createQuery` fetch with no explicit `retry` both resolve the same defaults via
`store.resolveAdapterOptions(perCall?)`, so they retry identically out of the
box. Disable with `Schedule.recurs(0)`, or bound it with e.g. `Schedule.recurs(3)`
or a `deadline`, at the store, model, or query level.

**`createQuery` is now Promise-first with a signal.** `QueryAdapter.fetch(id, {
offset, limit, signal })` — return a `Promise` (a rejection becomes an
`AdapterError`) or an `Effect`. `signal` aborts when the run is interrupted (a
`timeout` fires, a `retry` abandons the prior attempt, or the query is destroyed
/ superseded), exactly like a silo `DocumentAdapter`.

**Breaking — resilience config matches `ModelConfig`.**

- `backoff?: (attempt) => number` is **removed**. Pass `retry?:
Schedule.Schedule<unknown, AdapterError>` and `timeout?: Duration.DurationInput`
  instead — the same knobs as `ModelConfig.retry` / `ModelConfig.timeout` — or
  rely on the store-wide default. `fibonacciBackoff` is removed (its behavior is
  now the built-in `defaultRetry`).
- `Query.error` is now typed `SiloError | undefined` (was `Error | undefined`).

**Single-flight.** Starting a new `refetch()` / `fetchNextPage()` (or
`destroy()`) interrupts any in-flight fetch — its adapter `signal` aborts — so
overlapping requests can't race to write the store. Supersession is also
enforced _in the statechart_: every `Fetch` bumps the handle's internal fetch
generation and a run's events are stamped with it, so a superseded run's late
`Retrying` / `Failed` / `Settled` / `Aborted` is structurally dropped instead
of relying on interruption timing.

**Shared statechart.** `createQuery`'s transient state (`isFetching` / `error` /
`failureCount` / `lastError`) is now driven by the store's own handle statechart
(exposed to layered packages via the new `@supergrain/silo/internal` subpath)
instead of a parallel implementation, so the transitions match a document
handle's by construction. One observable alignment: `error` is no longer cleared
the moment a refetch starts — like a silo handle, the previous error stays
visible until the new fetch settles (success clears it; failure replaces it).

**`store.find` / `store.findQuery` validate the type.** Calling either with a
type that has no `DocumentStoreConfig` entry now throws immediately instead of
stranding handles on `isFetching` forever. The `null`-params /-id short-circuit
comes first, so the conditional-read idiom (`findQuery(type, ready ? params :
null)`) keeps returning the idle handle even while the type is absent from
config.

**No failure is silent.** A synchronously-throwing adapter (thrown before
returning a Promise/Effect) joins the typed channel as an `AdapterError`, like
a rejection. A throw while committing a `createQuery` page (malformed envelope,
frozen-doc insert) surfaces as a `ProcessorError` on `Query.error`. Anything
else that dies unexpectedly settles handles with a non-retryable `AdapterError`
tagged `reason: "defect"` instead of stranding them — and never interrupts
sibling chunks in the same batch window. `createQuery` failures (per attempt
and terminal) report to the store's `onError` sink, same as document fetches.

```diff
  // retry is now inherited from the store default; override per-query if needed:
- createQuery({ store, adapter, type, id, backoff: (n) => n * 1000 });
+ createQuery({ store, adapter, type, id, retry: Schedule.recurs(3) });
```

`effect` is a peer dependency (installed; you don't have to write Effect).
