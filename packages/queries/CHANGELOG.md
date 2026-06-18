# @supergrain/queries

## 6.3.0

### Patch Changes

- Updated dependencies [c959d10]
  - @supergrain/silo@6.3.0
  - @supergrain/kernel@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [cafa694]
  - @supergrain/silo@6.2.0
  - @supergrain/kernel@6.2.0

## 6.1.0

### Patch Changes

- Updated dependencies [d0d533f]
  - @supergrain/silo@6.1.0
  - @supergrain/kernel@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [8f6fe81]
  - @supergrain/silo@6.0.0
  - @supergrain/kernel@6.0.0

## 5.1.0

### Patch Changes

- Updated dependencies [9ffce96]
  - @supergrain/silo@5.1.0
  - @supergrain/kernel@5.1.0

## 5.0.0

### Minor Changes

- 82cf6a6: Run `@supergrain/queries` on the **same Effect engine** as the store, so a query
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

  **Single-flight.** Starting a new `refetch()` (or `destroy()`) interrupts any
  in-flight fetch — its adapter `signal` aborts — so overlapping requests can't
  race to write the store. `fetchNextPage()` instead **waits** for an in-flight
  fetch (superseding it would silently drop a fresher page 0 and merge the next
  page onto stale results), then reads `nextOffset` from what actually landed. A
  superseded run's returned promise follows its replacement, so `await refetch()`
  always reflects the state the query settled into rather than fulfilling
  silently. Supersession is also enforced _in the statechart_: every `Fetch`
  bumps the handle's internal fetch generation and a run's events are stamped
  with it, so a superseded run's late `Retrying` / `Failed` / `Settled` /
  `Aborted` is structurally dropped instead of relying on interruption timing.

  **Shared statechart.** `createQuery`'s transient state (`isFetching` / `error` /
  `failureCount` / `lastError`) is now driven by the store's own handle statechart
  (exposed to layered packages via the new `@supergrain/silo/internal` subpath)
  instead of a parallel implementation, so the transitions match a document
  handle's by construction. One observable alignment: `error` is no longer cleared
  the moment a refetch starts — like a silo handle, the previous error stays
  visible until the new fetch settles (success clears it; failure replaces it).

  **`store.find` / `store.findQuery` validate the type.** Calling either with a
  type that has no `DocumentStoreConfig` entry now throws when a fetch would be
  required, instead of stranding handles on `isFetching` forever. Validation
  guards only the fetch path: a **cached** document or query result — e.g. a
  JSON-API sideload inserted under a type that is never fetched directly — stays
  readable without a config entry. The `null`-params /-id short-circuit comes
  first, so the conditional-read idiom (`findQuery(type, ready ? params : null)`)
  keeps returning the idle handle even while the type is absent from config.

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

- 82cf6a6: Harden the shared retry engine so a retrying fetch is observable, bounded, and
  doesn't retry the unretryable — and stop leaking the store's raw defaults.

  **Failures are visible while retrying.** A handle now carries `failureCount` and
  `lastError` alongside the terminal `error`, and `onError` fires on **every failed
  attempt** (not just on give-up). Under the infinite default retry a down backend
  used to show a silent spinner — no `error`, no telemetry — until it gave up
  (never). Now each attempt bumps `failureCount` / `lastError` and notifies
  `onError`, so the outage is observable mid-retry; both reset to `0` / `undefined`
  on success. `@supergrain/queries`' `Query` exposes the same `failureCount` /
  `lastError`.

  **The default backoff is jittered.** `defaultRetry` is now jittered fibonacci
  (0.8–1.2× spread, clamped to 60s) so concurrent clients hitting a recovering
  endpoint don't retry in lockstep.

  **Retries respect retryability.** `AdapterError` takes an optional
  `retryable?: boolean`; a `retry` schedule only re-runs while the error is
  retryable (the default). Effect adapters mark a deterministic failure
  `retryable: false` to fail fast. Promise-first adapters — which reject rather
  than construct the error — get a config-level `retryable?: (error) => boolean`
  classifier (model / query / store, and `createQuery`) that inspects
  `error.cause` (e.g. a `Response`'s status); the error's own `retryable: false`
  remains a hard veto over the predicate. The classifier runs exactly once per
  failed attempt and its veto is **stamped onto the error** (`retryable: false`),
  so `handle.error` / `lastError` and the `onError` sink always agree with the
  engine's actual retry decision.

  **A throwing failure sink can't break the engine.** `onError` now fires per
  attempt, and `runAdapter` isolates it (and the `deadline` breach notification)
  in try/catch — the same contract the finder already kept for terminal
  `onError`, now honored on every per-attempt and deadline path.

  **Enriched `onError` context.** The sink now receives
  `{ type, keys, attempt, retryable }` — the 1-based attempt number and whether
  the failure passed the retryable check — so telemetry can chart retry rate or
  alert only on hard (`retryable: false`) failures. Additive; existing
  `{ type, keys }` destructuring is unaffected.

  **Overall deadline — on by default.** A new `deadline` knob (model / query /
  store, and `createQuery`) caps **all** attempts together, including retry
  backoff — distinct from the per-attempt `timeout`. On expiry the fetch fails
  with a non-retryable `AdapterError`. The built-in `defaultDeadline`
  (2 minutes) applies whenever no `deadline` is configured, so the infinite
  default retry always terminates and a handle's promise eventually rejects;
  opt out with `deadline: Duration.infinity`.

  **Structured failure reasons.** `AdapterError` carries `reason?: "adapter" |
"timeout" | "deadline" | "defect"` so consumers branch on a stable tag instead
  of regex-matching `cause.message` (`"defect"` marks an unexpected throw outside
  the typed channel — a bug, not a network failure).

  **Poison-id isolation (`isolateFailures`).** Opt-in (model / query / store):
  when a multi-id batch fails terminally, the chunk is bisected and the halves
  re-fetched once, isolating the offending id so its healthy batch-mates still
  load instead of all failing together. Off by default. Isolation needs a
  _terminal_ failure to engage, so when no `retry` is configured anywhere an
  isolating chunk automatically uses a bounded variant of the built-in default
  (`boundedDefaultRetry`, ~4 attempts); an explicitly configured `retry` —
  including an explicit `defaultRetry` — is honored as-is (provenance is tracked
  by resolution, not by reference comparison). A `deadline` breach is never
  bisected, and bisected halves inherit the chunk's **remaining** wall-clock
  budget rather than each recursion level re-arming a fresh one — the deadline
  stays the hard stop.

  **Bounded fan-out (`maxConcurrency`).** New store-wide
  `maxConcurrency?: number | "unbounded"` (default `"unbounded"`) caps how many
  `adapter.find` **attempts** run at once, so a large render (many chunks)
  doesn't fire every request simultaneously. The cap is a per-attempt semaphore:
  it composes across batch windows and `isolateFailures` bisection, and a chunk
  sleeping between retries releases its slot, so failing chunks never starve
  healthy ones. Values below 1 are rejected at store creation (a zero-permit
  semaphore would block every fetch forever).

  **Hardened query cache keys.** `stableStringify` now encodes non-finite numbers
  (`NaN` / `±Infinity`) distinctly — they previously all collapsed to `null` via
  `JSON.stringify`, colliding on one cache slot — and throws a clear error on
  cyclic params instead of overflowing the stack.

  **Breaking — `store.defaults` → `store.resolveAdapterOptions(perCall?)`.** The
  read-only `defaults` field is replaced by a method that merges per-call overrides
  over the store-wide `retry` / `timeout` / `deadline` (falling back to
  `defaultRetry`). Resolution now lives in one place instead of leaking the store's
  raw defaults onto its public surface. Layered helpers like `@supergrain/queries`
  call it.

  ```diff
  - const { retry, timeout } = store.defaults;
  + const { retry, timeout, deadline } = store.resolveAdapterOptions(perCallOverrides);
  ```

  The resolved shape also carries `retryIsDefault` — true when `retry` is the
  built-in fallback rather than anything configured — so layered code can tell
  "unset" apart from "explicitly set to `defaultRetry`" without reference
  comparisons.

### Patch Changes

- Updated dependencies [82cf6a6]
- Updated dependencies [b61db1b]
- Updated dependencies [82cf6a6]
- Updated dependencies [d4a918b]
- Updated dependencies [82cf6a6]
- Updated dependencies [82cf6a6]
  - @supergrain/kernel@5.0.0
  - @supergrain/silo@5.0.0

## 0.0.2

### Patch Changes

- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
  - @supergrain/kernel@4.0.0
  - @supergrain/silo@4.0.0
