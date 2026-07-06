# @supergrain/silo

## 7.0.1

### Patch Changes

- @supergrain/kernel@7.0.1

## 7.0.0

### Patch Changes

- @supergrain/kernel@7.0.0

## 6.3.0

### Minor Changes

- c959d10: Add `@supergrain/devtools`: a floating panel for inspecting a silo `DocumentStore`, modeled on the TanStack Query devtools.

  - `@supergrain/devtools/react` exports `<SupergrainDevtools store={store} />` — a corner toggle that opens a master/detail inspector over the store's cached documents and query results: live status badges, a metadata grid, and a collapsible value explorer. Tabs, counts, and the open detail update reactively as fetches settle and documents change, and inspecting never calls `find`, so opening it can't trigger a fetch.
  - `@supergrain/devtools` (framework-agnostic core) exports `snapshotSilo()` and `serialize()` for building custom inspectors.
  - `@supergrain/silo` now exposes a non-enumerable devtools bridge under `@supergrain/silo/devtools` (`getSiloDevtools`, `SILO_DEVTOOLS`) so tooling can read and subscribe to a store's internal state. Purely observational — no change to the public store surface.

### Patch Changes

- @supergrain/kernel@6.3.0

## 6.2.0

### Minor Changes

- cafa694: feat(silo/react): `createDocumentStoreContext` Provider can adopt a pre-built store

  The Provider now accepts a `store` prop as an alternative to `config`: pass a `DocumentStore` instance you constructed yourself (via `createDocumentStore`) and the Provider binds it to context as-is instead of constructing one. This is for the cases `config` can't serve — sharing one store instance across multiple React roots, or driving it from non-React code. (`config` paired with `initial`/`onMount` still covers SSR data transfer and in-tree imperative setup.)

  `config` and `store` are the two ends of one pipeline (a recipe vs. the store built from it), so they're mutually exclusive: provide exactly one. Supplying neither — or both — throws. `config` is now optional, which is a backward-compatible change (existing `config`-only usage is unaffected).

### Patch Changes

- @supergrain/kernel@6.2.0

## 6.1.0

### Minor Changes

- d0d533f: Add an optional store-wide `hooks` config (parallel to `models` / `queries`) with two hooks that bracket **every** `insertDocument(type, doc)` — direct inserts, response-processor inserts (including JSON-API `included` sideloads), and Provider `initial` seeds — forming the pipeline `prepareInsert → insertDocument → afterInsert`. Cross-cutting insert behavior (shape migrations, defaulting, mirroring to another store) now lives in one place.

  - **`prepareInsert(type, doc)`** normalizes on the way in. Following the response-processor `?? response` convention, returning nothing keeps the (possibly mutated) doc, returning a doc replaces it, and returning `null` vetoes the insert. Runs before the reactive proxy wraps a new doc.
  - **`afterInsert(type, doc)`** observes the committed doc on the way out (for telemetry, mirrors, derived indexes). Its throws are isolated to the store's `onError` sink, and it does not run when `prepareInsert` vetoes.

  See the silo README "Hooks" section for the full contract.

### Patch Changes

- @supergrain/kernel@6.1.0

## 6.0.0

### Major Changes

- 8f6fe81: Stored documents and query results are now **live and reactive in place** — `insertDocument` / `insertQueryResult` no longer `Object.freeze` the value they store.

  Silo sits on `@supergrain/kernel`'s fine-grained reactivity, but freezing the stored object opted it out of that graph: the kernel hands frozen targets back unwrapped, so reads off `handle.value` weren't tracked per field and in-place mutation was impossible. Removing the freeze restores the kernel's native behavior:

  - **Mutate a field in place** — `handle.value.attributes.name = "Ada"` re-renders only the readers of that field.
  - **Replace wholesale** — inserting a new object still re-renders whole-document readers, as before.
  - No copy is made on insert; `unwrap(handle.value)` recovers the exact object you inserted.

  **BREAKING CHANGE.** Two previously documented guarantees are gone:

  - `handle.value` is now a **reactive proxy** of the stored object, not the raw object you passed to `insertDocument`. `handle.value === insertedDoc` no longer holds — use `unwrap(handle.value)` if you need the raw reference. (Proxy identity is still stable across reads, so memoizing on `handle.value` is unaffected.)
  - Stored documents are **no longer frozen**. `Object.isFrozen(handle.value)` is now `false`, and a write that previously threw (top-level, strict mode) now succeeds and updates the cache reactively. If you want a document to stay immutable, freeze it yourself before inserting — but note that opts it out of per-field reactivity.

### Patch Changes

- @supergrain/kernel@6.0.0

## 5.1.0

### Minor Changes

- 9ffce96: Add an ordered response-processor pipeline to both surfaces — `ModelConfig`
  (documents) and `QueryConfig` (queries).

  A model or query can now declare `processors: [...]` — an ordered pipeline run
  in declared order after `adapter.find(...)` resolves. This makes the fetch
  lifecycle explicit and lets applications compose response work in execution
  order (migrate → mirror into another store → insert into silo) instead of
  cramming every responsibility into one processor.

  ```ts
  "card-stack": {
    adapter: cardStackAdapter,
    processors: [
      migrateCardStackResponse(),                 // mutate fetched docs in place
      mirrorResponseDocumentsToEmber(emberStore), // side effect: hydrate another store
      jsonApiProcessor,                           // insert into silo
    ],
  }
  ```

  **Ordered pipeline semantics.** Silo passes the adapter response through each
  processor in order. A processor may mutate the response, **return a replacement
  response** (handed to later processors), perform side effects, or insert
  documents. Returning `undefined` — or `null` — passes the current response
  through unchanged (pass-through uses `??`, so `null` can't be used to replace
  the response). A throw stops the pipeline (the remaining processors don't run)
  and fails the chunk with a `ProcessorError` — the same terminal behavior as a
  single `processor` throw.

  **Backward compatible config.** The single `processor` field still works and is
  normalized to a one-element pipeline, so `{ adapter }`,
  `{ adapter, processor: defaultProcessor }`, and
  `{ adapter, processors: [defaultProcessor] }` are all equivalent. Setting
  **both** `processor` and `processors` on the same model is a configuration error
  and throws at store creation.

  **Processor signatures.** Both processor types now have the shape
  `(response, context) => unknown | void`:

  - `ResponseProcessor` (documents): `context` is `{ store, type, ids }`
    (previously `(raw, store, type) => void`).
  - `QueryProcessor` (queries): `context` is `{ store, type, paramsList }`
    (previously `(raw, store, type, paramsList) => void`).

  The bundled `defaultProcessor` / `jsonApiProcessor` / `defaultQueryProcessor`
  and every config that uses them are unaffected; hand-written custom processors
  that relied on the old positional arguments should read `store` / `type` /
  `paramsList` off the context object and can now return a replacement response.
  New `ProcessorContext` and `QueryProcessorContext` types are exported for typing
  custom processors.

### Patch Changes

- @supergrain/kernel@5.1.0

## 5.0.0

### Major Changes

- 82cf6a6: Rebuild the network/async layer on an internal [Effect](https://effect.website/) engine and remodel the reactive handle as a statechart. **Breaking.**

  **Adapters stay Promise-first.** `DocumentAdapter.find` returns `Promise<unknown> | Effect.Effect<unknown, AdapterError>` — **return a plain `Promise`** for the common case (the store runs it on its Effect engine and turns a rejection into an `AdapterError` for you), or **return an `Effect`** to own the failure channel / compose retries / manage resources. Effect powers the engine internally but is not required at the adapter boundary. `effect` is a peer dependency (installed, but you don't have to write Effect).

  **Typed errors.** New `AdapterError` / `NotFoundError` / `ProcessorError` (`Data.TaggedError`, union `SiloError`), exported from the root. They are the `E` channel of adapter Effects and the error carried by a failed handle.

  **Per-model `retry` / `timeout`.** `ModelConfig` and `QueryConfig` accept an Effect `Schedule` (`retry`) and a `Duration` (`timeout`).

  **Effect-clock batch window + `AbortSignal` plumbing.** The batch window now runs on `Effect.sleep` (the whole engine is on Effect's clock) and chunks fan out concurrently. Adapters receive an optional abort signal — `find(ids, { signal })` — that aborts when the adapter Effect is interrupted (e.g. a per-model `timeout` fires): thread it into `fetch(url, { signal })` for a real network abort, or ignore it. The React `useDocument` / `useQuery` hooks are **pure reactive reads**; an in-flight fetch is not cancelled when a component unmounts (it completes and caches).

  **The handle fields changed.** `DocumentHandle` / `QueryHandle` are now a `status`-discriminated union over flat fields:

  ```ts
  type DocumentHandle<T, E = SiloError> =
    | {
        status: "pending";
        value: undefined;
        error: undefined;
        fetchedAt: undefined;
        isFetching: boolean;
        promise: Promise<T> | undefined;
      }
    | {
        status: "success";
        value: T;
        error: E | undefined;
        fetchedAt: Date; // refetch error coexists
        isFetching: boolean;
        promise: Promise<T> | undefined;
      }
    | {
        status: "error";
        value: undefined;
        error: E;
        fetchedAt: undefined;
        isFetching: boolean;
        promise: Promise<T> | undefined;
      };
  ```

  The previous `status: "IDLE" | "PENDING" | "SUCCESS" | "ERROR"`, `data: T | undefined`, `isPending`, and `hasData` are gone; `error` is now a typed `SiloError`. Narrowing on `status` refines `value` to `T`; `error` and `value` coexist in `success` (stale-while-revalidate); `isFetching` is orthogonal (stays out of `status`, so `status` doesn't flip on a background refetch); each field is tracked independently (fine-grained reactivity).

  Migration: replace `handle.data` with `handle.value`; `handle.isPending` with `handle.value === undefined && handle.isFetching`; `handle.hasData` with `handle.value !== undefined`; the remaining `handle.status` string literals are now lowercase (`"SUCCESS"` → `"success"`, `"ERROR"` → `"error"`).

  The old `"IDLE"` status is gone — it folded into `"pending"`. No capability is lost: "not started" was never a data state, and it's now expressed on the orthogonal `isFetching` axis. An idle / not-yet-fetched handle (a `find(null)` / `useDocument(type, null)` conditional read, or a handle no one has requested yet) is `status: "pending"` with `isFetching: false` and `promise: undefined`; an in-flight first load is `status: "pending"` with `isFetching: true`. So replace `handle.status === "IDLE"` with `handle.status === "pending" && !handle.isFetching`. TypeScript flags any leftover `"IDLE"` comparison at compile time (it's no longer in the union), so this can't break silently.

  **Insert semantics.** `insertDocument` / `insertQueryResult` while a fetch is in flight no longer flips `isFetching` off — the activity flag now tracks the actual fetch, which still settles (and clears it) on its own. `fetchedAt` is only stamped when an insert answers a fetch or first populates the handle; a local insert into an already-loaded idle handle (a websocket push) preserves it, so TTL-style staleness checks still see when the data was last _fetched_. Inserting `undefined` is a no-op (it records nothing and keeps the pending promise's resolvers armed, so a following failure still rejects it).

  Promise-returning adapters keep working as-is — no `Effect.tryPromise` wrapping required.

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
- Updated dependencies [d4a918b]
  - @supergrain/kernel@5.0.0

## 4.0.0

### Major Changes

- 6065b78: Initial release of `@supergrain/silo` — a reactive document cache for React with first-class request batching. Built on `@supergrain/kernel`'s reactive primitive; documents live in the same reactive graph as the rest of your state.

  - **`createDocumentStore(config)`** — plain primitive. Returns `{ find, findInMemory, insertDocument, clearMemory, findQuery, findQueryInMemory, insertQueryResult }`. One reactive tree per store; handles are plain objects nested in that tree.
  - **`createDocumentStoreContext<S>()`** (from `@supergrain/silo/react`) — returns `{ Provider, useDocumentStore, useDocument, useQuery }` tied to a fresh React Context. The Provider takes `config: DocumentStoreConfig<M, Q>` (required), optional `initial` for declarative seeding (`{ model: { [type]: { [id]: doc } }, query: { [type]: [{ params, result }] } }`), and optional `onMount: (store) => void` for imperative setup (preloads, subscriptions). The Provider calls `createDocumentStore(config)` exactly once per mount, so SSR requests, tests, and React trees are isolated by construction.
  - **Finder** (internal) — batches `find(type, id)` calls within `batchWindowMs` (default 15ms) and chunks at `batchSize` (default 60) per `adapter.find(ids)` call. 50 `useDocument` calls in one render collapse to one network request.
  - **Processors** — `defaultProcessor` (any REST endpoint returning `{id, ...}` or `[{id, ...}]`), `defaultQueryProcessor` (results aligned 1:1 with input params by position), and `jsonApiProcessor` (handles `{ data, included }` envelopes; sideloaded docs drop into the documents cache automatically).
  - **JSON-API relationship hooks** — `useBelongsTo` / `useHasMany` / `useHasManyIndividually` from `@supergrain/silo/react/json-api`. Type-inferred from `Relationship<T>` / `RelationshipArray<T>`; reach the store via a shared ambient Context populated by every Provider.
  - **Module-augmentation `TypeRegistry`** lets consumers declare their document-type map once and get typed hooks everywhere without per-call-site generics.

  Handle lifecycle (`IDLE → PENDING → SUCCESS | ERROR`) is pinned property-by-property on a stable handle object — `store.find("user", "1")` returns the same object on every call, with fields that mutate in place when data lands. Suspense via `use(handle.promise)`; the promise reference is stable across `insertDocument` so suspended components don't re-suspend on cache updates.

  ```tsx
  import type { DocumentStore } from "@supergrain/silo";
  import { createDocumentStoreContext } from "@supergrain/silo/react";

  type DocStore = DocumentStore<TypeToModel, TypeToQuery>;
  export const { Provider, useDocument, useDocumentStore, useQuery } =
    createDocumentStoreContext<DocStore>();

  // <Provider config={{ models: {...}, queries: {...} }}><App /></Provider>
  // const user = useDocument("user", id);
  // const dashboard = useQuery("dashboard", { workspaceId: 7 });
  ```

### Patch Changes

- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
- Updated dependencies [6065b78]
  - @supergrain/kernel@4.0.0

## 2.0.1

### Patch Changes

- Updated dependencies [2b2e786]
  - @supergrain/kernel@2.0.1

## 2.0.0

### Major Changes

- ae766bd: ### Breaking Changes

  - **`createStore` returns the store directly** — `createStore(initial)` now returns the reactive proxy instead of a `[store, update]` tuple. Change `const [store] = createStore(...)` to `const store = createStore(...)`.
  - **`update` is a standalone function** — Import `update` from `@supergrain/kernel` and pass the store as the first argument: `update(store, { $set: { count: 5 } })`.
  - **Removed `SetStoreFunction` and `StrictSetStoreFunction` types** — These typed the bound update function which no longer exists.

  ### New Features

  - **`provideStore(store)`** — Wraps a store with React context plumbing. Returns `{ Provider, useStore }` for injecting a store into the component tree. The proxy identity is stable so the context value never triggers re-renders.
  - **`useComputed(() => expr, deps?)`** — Derived value hook that acts as a firewall. Re-evaluates when upstream signals change, but only triggers a re-render when the result changes. Enables O(2) row selection without per-row flags.
  - **`useSignalEffect(() => sideEffect)`** — Signal-tracked side effect tied to component lifecycle. Re-runs when tracked signals change, cleans up on unmount. Does not cause re-renders.

  ### Performance

  - **Standalone `update` batches automatically** — Operations are wrapped in `startBatch/endBatch` so effects fire once per call.

### Patch Changes

- Updated dependencies [ae766bd]
  - @supergrain/kernel@2.0.0

## 1.3.0

### Minor Changes

- e931b84: ### Performance

  - **O(1) row selection** — Moved `isSelected` from a computed comparison (`selected === item.id`) to a boolean property signal on each row item. Select now flips two booleans instead of re-evaluating every row, eliminating the O(n) scan.
  - **Skip signal reads without active subscriber** — When no tracking context exists (`getCurrentSub()` is null), property reads short-circuit past signal creation and return the raw value directly. Zero-cost reads outside reactive contexts.
  - **flushSync for select** — Wrapped the select handler in `flushSync` for synchronous DOM commits, matching Krause benchmark measurement.

  ### New Features

  - **Signal profiler** — New opt-in profiler for diagnosing signal behavior. Tracks reads, writes, skipped reads, and effect runs. Zero cost when disabled. New exports: `enableProfiling`, `disableProfiling`, `getProfile`, `resetProfiler`.

  ### Breaking Changes

  - **Typed/schema API removed** — Deleted `createModelView`, `SchemaLike`, `attachViewNodes`, and the `createStore(state, schema)` overload. The typed layer and all associated benchmarks/tests have been removed.

### Patch Changes

- Updated dependencies [e931b84]
  - @supergrain/kernel@1.3.0

## 1.2.0

### Patch Changes

- Updated dependencies [adafe77]
  - @supergrain/kernel@1.2.0

## 1.1.0

### Patch Changes

- Updated dependencies [20a6f46]
  - @supergrain/kernel@1.1.0

## 1.0.4

### Patch Changes

- Updated dependencies [4bbe1d6]
  - @supergrain/kernel@1.0.4

## 1.0.3

### Patch Changes

- Fix missed re-renders from array mutation methods

  Wrap array mutation methods (push, pop, shift, unshift, splice, sort, reverse, fill, copyWithin) in startBatch()/endBatch() so all internal proxy set/delete operations are batched into a single notification. Previously, multi-element operations like `push(a, b, c)` or `splice()` would fire effects once per internal operation instead of once for the entire mutation.

- Updated dependencies
  - @supergrain/kernel@1.0.3

## 1.0.2

### Patch Changes

- 73daaff: Include README in published packages (replace symlinks with copies)
- Updated dependencies [73daaff]
  - @supergrain/kernel@1.0.2

## 1.0.1

### Patch Changes

- 535cb00: Add README to published packages
- Updated dependencies [535cb00]
  - @supergrain/kernel@1.0.1

## 1.0.0

### Major Changes

- 61abd45: ## 1.0.0 — First Stable Release

  Supergrain is the fastest, most ergonomic reactive store for React. Mutate plain objects directly — only components that read the changed property re-render.

  ### Highlights

  **Plain-object reactivity** — No actions, reducers, selectors, or providers. Create a store and mutate it like any JavaScript object:

  ```ts
  const [store] = createStore({ count: 0 });
  store.count = 1; // only components reading count re-render
  ```

  **Automatic render scoping** — `tracked()` subscribes a component only to the properties it reads. A parent updating `store.selected` won't re-render a child that only reads `item.label`.

  **Optimized list rendering** — The `<For>` component tracks which array items actually changed:

  ```ts
  store.todos[500].completed = true; // only row 500 re-renders, not the other 999
  ```

  **Full TypeScript inference** — Store shapes, update operators, and dot-notation paths are all inferred from usage.

  **Synchronous state** — Changes apply immediately. No batching queues, no tick delays.

  **Update operators** — Optional structured mutations for batch operations that go beyond simple property assignment:

  ```ts
  const [store, update] = createStore({ tags: ["react", "signals", "react"] });
  update({ $addToSet: { tags: "new-tag" }, $pull: { tags: "react" } });
  ```

  Nine operators (`$set`, `$unset`, `$inc`, `$push`, `$pull`, `$addToSet`, `$min`, `$max`, `$rename`) — all type-safe with dot-notation path inference. Inspired by MongoDB's update operators.

  ### Packages

  - **@supergrain/kernel** — `createStore`, `unwrap`, `update`, and signal primitives from [alien-signals](https://github.com/johnsoncodehk/signals) (`signal`, `computed`, `effect`, `startBatch`, `endBatch`)
  - **@supergrain/kernel/react** — `tracked()` for per-component reactivity, `<For>` for optimized lists, re-exports everything from core. Requires React 18.2+ or 19.x.
  - **@supergrain/store** — Document-oriented store for app-level state: look up records by model and ID, with built-in fetch handling and reactive loading/error states.

  ### Install

  ```
  pnpm add @supergrain/kernel/react
  ```

### Patch Changes

- Updated dependencies [61abd45]
  - @supergrain/kernel@1.0.0

## 0.1.0

### Minor Changes

- f9d5e75: Initial

### Patch Changes

- Updated dependencies [f9d5e75]
  - @supergrain/kernel@0.1.0
