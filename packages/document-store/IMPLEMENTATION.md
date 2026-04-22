# @supergrain/document-store — Implementation Spec

A design document for implementing the document-store read layer. The
class skeletons and failing tests define the contract; this doc explains
the intent and internal mechanics behind them.

---

## Goals

- **Suspense-compatible, not Suspense-mandatory.** `DocumentHandle.promise`
  is a stable, Suspense-safe reference designed for React 19 `use()`.
  Consumers opt in at the call site with `use(handle.promise)`; consumers
  who want inline loading branch on `handle.status`. The same hook serves
  both. Stable promise identity across refetches (so `use()` doesn't
  re-suspend) and a fresh promise object after an error → success
  transition (so a Suspense boundary nested in an error boundary can
  recover) are part of the contract.
- **Request batching is first-class.** N `useDocument` calls within
  `batchWindowMs` collapse into one `adapter.find(ids)` call. This is
  what makes Suspense actually scalable — naive Suspense-throwing hooks
  cause request waterfalls; the Finder prevents them by design.
- **Stable reactive handles.** `store.find(type, id)` returns the same
  object on repeat calls. Fields mutate reactively. No render-cycle
  identity churn, no selector ceremony.

---

## Architecture

One public class (`DocumentStore`) composed over three internal pieces,
each with a single responsibility:

```
┌───────────────────────────────────────────────────────────────┐
│  DocumentStore  — public orchestrator                         │
│                   find, findInMemory, insertDocument,         │
│                   clearMemory                                 │
└─────┬──────────────────────────┬──────────────────────────────┘
      │ delegates reads/writes   │ delegates fetches (internal)
      ▼                          ▼
┌───────────────────┐   ┌───────────────────────────┐
│  MemoryEngine     │   │  Finder (INTERNAL)        │
│  reactive cache   │   │  batching / dedup /       │
│  insert, find,    │   │  chunking                 │
│  clear            │   │  find(type,id) → Promise  │
└───────────────────┘   └───────────┬───────────────┘
                                    │ calls (per chunk, per type)
                                    ▼
                        ┌───────────────────────────┐
                        │  adapter (per-model)      │
                        │  find(ids) → Promise<raw> │
                        └───────────┬───────────────┘
                                    │ raw response
                                    ▼
                        ┌───────────────────────────┐
                        │  processor (per-model)    │
                        │  (raw, store, type) → void│
                        └───────────────────────────┘
```

**DocumentStore** owns the public API and handle lifecycle. **MemoryEngine**
doesn't know about network or handles. **Finder** is internal — not in the
package's public exports — and handles batching/dedup/chunking. **Adapter**
is a pure transport (consumer-owned). **Processor** is a stateless transform
that inserts into the store.

> Naming note: the class is `DocumentStore` (not `Store`) to
> disambiguate from `@supergrain/react`'s `StoreProvider` / `useStore`,
> which deals with generic reactive state. A "store" in this package is
> specifically a document-oriented cache keyed by `(type, id)`.

---

## Wiring

One-step. The `DocumentStore` constructor takes per-model adapter +
processor config and optional batching knobs; it constructs the internal
`MemoryEngine` and `Finder` itself.

```ts
const store = new DocumentStore<M>({
  models: {
    user: { adapter: userAdapter },
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
  batchWindowMs: 15, // optional, default 15
  batchSize: 60, // optional, default 60
});
```

`Finder` isn't exported. Consumers don't touch it; its behavior is tuned
through `batchWindowMs` and `batchSize` on the store config.

---

## Type requirements

Consumer document types need only carry `id: string`. The library keys
every operation by the `type` argument supplied at the API boundary
(`find(type, id)`, `insertDocument(type, doc)`, `findInMemory(type, id)`) —
nothing in the library reads a `type` field off a doc.

```ts
type DocumentTypes = Record<string, { id: string }>;

type TypeToModel = {
  user: { id: string; name: string };               // no `type` field needed
  post: { id: string; title: string };
  "card-stack": { id: string; type: "card-stack"; attributes: { ... } };
  // ^ `type` here is just a convenience for the consumer; the library
  // doesn't read it. JSON-API envelopes supply type inline and
  // jsonApiProcessor reads it from the envelope, not from the cached doc.
};
```

This is intentional: APIs that don't emit `type` on documents (many REST
endpoints, custom formats) work without any wrapper.

---

## DocumentStore

The `DocumentStore<M>` class is a thin orchestrator that composes a
`MemoryEngine<M>` (reactive cache) and a `Finder<M>` (internal fetching
pipeline). All memory operations delegate to the engine; `find` checks
the engine first and falls back to the finder on miss.

### `find(type, id | null | undefined) → DocumentHandle<T>`

Returns a **stable, reactive handle**. Same `(type, id)` must return
the same handle object on repeat calls.

Logic:

1. `id` is `null`/`undefined` → return an idle handle (all fields at
   their idle invariant values, status `IDLE`).
2. `memoryEngine.find(type, id)` returns a value → return a handle
   with status `SUCCESS`, `data` set, `isPending: false`,
   `isFetching: false`, `hasData: true`, `fetchedAt: <Date>`,
   `promise` pre-resolved.
3. Not in memory → call `finder.find(type, id)` (which queues a
   fetch), return a handle with status `PENDING`, `isPending: true`,
   `isFetching: true`, `promise: <pending>`. When the finder resolves,
   transition the handle to `SUCCESS` (or `ERROR` on rejection).

The handle is **reactive**: reading `handle.data` inside a `tracked()`
scope subscribes to changes. `data` is a computed signal over
`memory.find(type, id)`, so it auto-updates on any write at that key
— fetch completion, external `insertDocument`, socket push,
`clearMemory`.

> No `findMany` on the store. Batch reads happen at the React layer
> (`useDocuments` / `useHasMany`) by composing per-id `find` calls.
> Collapsing the resulting N fetches into one adapter call is the
> Finder's job, not a separate store method.

### `findInMemory(type, id) → T | undefined`

Direct delegation to `memoryEngine.find(type, id)`. Also reactive —
subscribing to a missing doc is valid; when it's later inserted,
dependent scopes re-run.

### `insertDocument(type, doc) → void`

Delegates to `memoryEngine.insert(type, doc)`. Keyed by `(type, doc.id)`.
Overwrites any existing document at that key. Fully reactive.

Last-write-wins: no revision tracking, no optimistic conflict resolution
(that belongs in a write layer, not this PR). In particular, if an
`insertDocument` lands **during an in-flight fetch for the same key**,
then:

1. The local insert writes first.
2. When the fetch resolves, its processor calls `insertDocument` with
   the fetched value, which **overwrites** the local insert.
3. No reconciliation — the fetched value wins.

This matches the "read layer has no write semantics" boundary. Apps
that need optimistic writes with reconciliation build on a later
write-layer PR.

### `clearMemory() → void`

Drops every cached document in a single atomic reset (not N per-key
invalidations). Effects on existing handles:

- Handles with `status === "SUCCESS"` flip to `IDLE` if there's no
  in-flight fetch for their key. Their `data` becomes `undefined`, and
  their stable `promise` reference is cleared (replaced by `undefined`).
- Handles with `status === "PENDING"` stay `PENDING` — the fetch is
  still in flight; the result will land on the handle when it returns.
- The in-flight fetch itself is **not cancelled** by `clearMemory` —
  when it resolves, its processor runs `insertDocument` and the
  re-populated doc is observed normally. Cancellation is a separate
  concern (not in this PR).

---

## MemoryEngine

The reactive storage primitive. `DocumentStore` composes one.

```ts
class MemoryEngine<M extends DocumentTypes> {
  insert<K extends keyof M & string>(type: K, doc: M[K]): void;
  find<K extends keyof M & string>(type: K, id: string): M[K] | undefined;
  clear(): void;
}
```

Implementation: a per-document signal keyed by `"<type>:<id>"`.
`insert` writes the signal at that key. `find` reads it. `clear`
resets all signals to `undefined` in a single batch so dependent
scopes re-run once, not N times.

MemoryEngine is deliberately unaware of handles, fetching, or
processing. That keeps its surface minimal and independently
testable.

---

## Finder (internal)

Not exported from the package root. Lives in `src/finder.ts`; constructed
by `DocumentStore` in its own constructor. Split into a separate module
purely for separation of concerns — batching / dedup / chunking has
nothing to do with cache storage or handle lifecycle — but it's not
pluggable.

Constructor receives:

- Per-model config (adapter + optional processor), forwarded from
  `DocumentStoreConfig.models`
- `batchWindowMs` (default **15** — roughly one frame / tick; long
  enough to collapse the renders a typical list triggers, short enough
  to not feel laggy)
- `batchSize` (default **60** — fits under common backend `IN`
  clause / query-param limits and avoids URL length issues)
- A direct reference to the parent `DocumentStore` (passed via `this`
  from the store's constructor). No two-step `attachStore` ceremony.

### `find(type, id) → Promise<T>`

Queues a request, returns a promise that resolves when the document
arrives via the pipeline.

Rejects (synchronously throws) if `type` is not in the configured models.

### Pipeline

On each `finder.find(type, id)` call:

1. If `store.findInMemory(type, id)` returns a value, resolve
   immediately (no queue, no adapter call).
2. Otherwise, check if there's already an in-flight request for
   `(type, id)` — **dedup**. If yes, return that same promise.
3. Otherwise, create a new deferred (promise + resolve/reject), add
   `{ type, id, resolve, reject }` to a pending queue.
4. If no batch timer is running, start one: `setTimeout(drainBatch,
batchWindowMs)`.
5. Return the deferred's promise.

### `drainBatch()`

1. Take the pending queue, group by `type`.
2. For each type group, dedupe ids (multiple deferreds for the same id
   already share one entry).
3. Chunk each type's ids into groups of at most `batchSize`.
4. For each chunk:
   a. Call `adapter.find(ids)`.
   b. On success: pass the raw response to the model's processor
   (`config.models[type].processor ?? defaultProcessor`), along with
   the `store` reference and the chunk's type. The processor inserts
   documents via `store.insertDocument(type, doc)` and returns
   `void`. Then, for each deferred in the chunk, look up the doc by
   its key: `store.findInMemory(type, deferred.id)`. Found → resolve
   with it. Not found → reject with `Error("document not found")`.
   c. On adapter error: reject all deferreds for that chunk with the
   error.
5. Clear the batch timer.

### In-flight tracking

Keep a `Map<string, { promise, resolve, reject }>` keyed by
`"<type>:<id>"` for currently-requested documents. Add entries when
a request enters the queue; remove them when the adapter response
resolves or rejects. Concurrent `find(type, id)` calls while in
flight return the existing promise.

### Retries (NOT in this PR)

The Ember finder retries failed fetches with fibonacci backoff. This
spec does NOT include retries. A rejected adapter call rejects the
deferred; the handle flips to `ERROR`. Retry logic is a later
enhancement.

### Refetching (NOT in this PR)

The lifecycle diagram below mentions `SUCCESS → refetch`, but this PR
does not expose an imperative refetch API. `DocumentHandle` has no
`.refetch()` method in this PR. A refetch is observed only as a
side-effect of an external `insertDocument` call with a fresher doc
(e.g. from a socket push, or a write-layer response). Explicit
`refetch()` is a later enhancement.

---

## Adapter

```ts
interface DocumentAdapter {
  find(ids: Array<string>): Promise<unknown>;
}
```

That's it. The adapter is a consumer-owned transport — it decides
_how_ data gets fetched for a given set of ids:

- one bulk GET (`/users?ids=1&ids=2`)
- N parallel single-doc GETs (`Promise.all(ids.map(id => fetch(...)))`)
- a websocket request/response cycle
- anything else

The library doesn't inspect the raw response; only the paired processor
does. Adapters are free to fulfill the contract however they want — the
tests in `adapters.test.ts` show both a bulk-style adapter (`user`) and
a fan-out-style adapter (`post`) working against the same store.

Adapters throw (reject) on network/server errors. The finder treats
any rejection as a fetch failure for the whole chunk.

---

## Processor

A processor is a **plain function** — no `.process()` method, no
class. Processors are stateless transforms; a function is the right
primitive.

```ts
type ResponseProcessor<M extends DocumentTypes> = (
  raw: unknown,
  store: DocumentStore<M>,
  type: keyof M & string,
) => void;
```

Given the raw adapter response, the store, and the type the caller
originally passed to `find(type, id)`, a processor:

1. Parses the raw shape (opaque to the library).
2. Calls `store.insertDocument(type, doc)` for every doc it wants
   cached — primary docs under the fetch type, sideloads under their
   own types.
3. Returns `void`. The finder subsequently reads the inserted docs
   back via `store.findInMemory(type, id)` to resolve deferreds.

The `type` argument is useful when the raw response doesn't carry
type info (e.g. `[{ id: "1", name: "..." }, ...]` from a REST
endpoint). Processors whose envelope includes type inline (JSON-API's
`data.type` / `included[i].type`) can read type from the envelope and
ignore the argument.

### `defaultProcessor` — exported from `/processors`

Used when `ModelConfig.processor` is omitted. Handles the simple case:

```ts
function defaultProcessor(raw, store, type) {
  const docs = Array.isArray(raw) ? raw : [raw];
  for (const doc of docs) store.insertDocument(type, doc);
}
```

The adapter returns either a single document or an array of documents.
Each is inserted under the caller's `type` using the doc's own `id`.
No envelope, no sideloading, no type-on-doc assumption.

### `jsonApiProcessor` — exported from `/processors/json-api`

For consumers whose API speaks JSON-API–style `{ data, included }`. Opt
in per-model:

```ts
import { jsonApiProcessor } from "@supergrain/document-store/processors/json-api";

new DocumentStore<M>({
  models: {
    user: { adapter: userAdapter, processor: jsonApiProcessor },
    // ...
  },
});
```

Inserts every document in `data + included`, keyed by each doc's own
`type` field from the envelope (JSON-API requires resource objects to
carry `type`). The `type` argument passed in is ignored — sideloads
especially span many types unrelated to the fetched one.

The subpath also exports JSON-API-shape TypeScript helpers:
`Relationship<T>`, `RelationshipArray<T>`, and `JsonApiDocument<Type,
Attrs, Rels>`.

### Custom processors

Consumers can write their own for any other envelope (GraphQL, REST
envelopes, etc.). Just a function with the `ResponseProcessor<M>`
signature.

Processors are **synchronous**. If you need async normalization, do it
in the adapter before returning.

### Error handling

If the processor throws, the finder rejects all deferreds for that
chunk with the thrown error. Same semantics as an adapter error.

---

## DocumentHandle

`DocumentHandle<T>` is an **interface**, not a class. Internally the
DocumentStore builds handles as signal-backed reactive objects via
`@supergrain/core` primitives. Consumers never construct a handle
directly — they read them off `DocumentStore.find`.

### Reactive composition

Two channels drive the handle's fields:

1. **Memory signal** — `handle.data` is a computed signal over
   `memoryEngine.find(type, id)`. It updates automatically whenever
   memory changes at that key, regardless of who wrote it (fetch
   completion, external `insertDocument`, socket push, `clearMemory`).
2. **Explicit lifecycle updates** — `status`, `error`, `promise`,
   `fetchedAt` are managed by `DocumentStore.find` based on the promise
   outcome from Finder. On fetch path: set PENDING, then chain
   `.then → SUCCESS` / `.catch → ERROR`. On memory-hit path: set
   SUCCESS immediately. `fetchedAt` updates only on fetch-driven
   success, not on unrelated memory writes.

### Lifecycle

```
IDLE ──(id becomes non-null and not-cached)──► PENDING
IDLE ──(id becomes non-null and cached)─────► SUCCESS

PENDING ──(finder resolves)──► SUCCESS
PENDING ──(finder rejects) ──► ERROR

SUCCESS ──(new insertDocument writes a fresher doc)──► SUCCESS
ERROR   ──(later insertDocument with valid doc)─────► SUCCESS (new promise)
```

**IDLE is one-way.** Once a handle moves off `IDLE` (because its
`(type, id)` had a non-null id), it never returns to `IDLE`. Stable
handle identity is tied to `(type, id)` — if the id changes, the caller
gets a _different_ handle, not the same handle resetting to `IDLE`. The
only way a live handle's `status` becomes `IDLE` again is `clearMemory`
(see `DocumentStore.clearMemory` notes above).

**Stable handle identity**: two calls to `store.find("user", "1")`
return the same object. The handle's fields update reactively — the
reference never changes once created. Implementation: store handles
in a `Map<string, DocumentHandle<any>>` keyed by `"<type>:<id>"`.

**Reactive fields**: `status`, `data`, `error`, `isPending`,
`isFetching`, `hasData`, `fetchedAt`, `promise` are all signals
under the hood, so reads inside a `tracked()` scope re-render on
change.

**`promise` semantics** (for React 19 `use()`):

- `undefined` when IDLE
- Pending on the first fetch
- Resolves once on success, stays resolved across refetches (refetch
  updates `data`/`isFetching`, doesn't replace the promise)
- Rejects once on first error
- If refetch succeeds after an error, create a NEW promise object
  (so a Suspense boundary inside an error boundary can recover)

---

## React binding

`@supergrain/document-store/react` exports two paths:

**Default singleton** — what 95% of apps use:

```ts
import {
  DocumentStoreProvider,
  useDocument,
  useDocuments,
  useDocumentStore,
} from "@supergrain/document-store/react";
```

These are free-standing, bound to a single module-level context. Mount
one `<DocumentStoreProvider init={initStore}>` and the hooks read from
it.

**Factory escape hatch** — for libraries shipping their own document
store, micro-frontends that need isolation, or advanced cases needing
multiple coexisting stores in the same tree:

```ts
import { createDocumentStoreContext } from "@supergrain/document-store/react";

const libStore = createDocumentStoreContext<LibTypes>();
// libStore.Provider, libStore.useDocument, etc. are bound to their own Context
```

Internally, the free-standing exports are literally `defaultContext.*`
where `defaultContext = createDocumentStoreContext()`. Zero runtime
cost for consumers who never touch the factory.

Subpath `useBelongsTo` / `useHasMany` / `useHasManyIndividually` (from
`/react/json-api`) compose on the default context. Libraries using the
factory that also want JSON-API hooks write ~5 lines on top of
`libStore.useDocument`.

`useHasMany` and `useHasManyIndividually` differ only in output shape:

- `useHasMany(model, rel)` → one `DocumentsHandle<T>` aggregating every
  related doc (one `status`, one `promise`, `data: ReadonlyArray<T>`).
  Use when the list renders as a single unit ("show spinner until all
  loaded").
- `useHasManyIndividually(model, rel)` → `ReadonlyArray<DocumentHandle<T>>`,
  one handle per related doc, each with its own `status`/`data`/`error`.
  Use when each list item owns its own loading / error UI (skeleton rows,
  per-card fallbacks). Fetching is still batched into one
  `adapter.find(ids)` call — the split is only in what the hook returns.

---

## Testing contracts

Failing tests pin the behavior. Source files map to tests (plus two
non-1:1 test files that test integration / adapter behavior):

- `src/memory.ts` ↔ `tests/memory.test.ts` — insert, find, overwrite,
  keying by (type,id), clear, documents without a `type` field, reactivity
  (per-key subscribe, single batched re-run on clear)
- `src/processors/index.ts` ↔ `tests/processors/index.test.ts` —
  `defaultProcessor` (single doc, array, uses the `type` argument, no
  envelope unwrap, no type-on-doc assumption) and `defaultQueryProcessor`
  (pairs results with `paramsList` by position, single-entry batch, returns void)
- `src/processors/json-api.ts` ↔ `tests/processors/json-api.test.ts` —
  `jsonApiProcessor` (`{data,included}` unwrap, sideload, empty data,
  mixed types, reads type from envelope, ignores the `type` argument)
- `src/finder.ts` ↔ `tests/finder.test.ts` — batching within a tick
  window, per-type isolation, dedup (concurrent + in-flight, same-id
  handle identity), chunking (default + custom batchSize), error
  propagation from adapter/processor, adapter-style agnosticism (bulk
  vs fan-out). Uses in-memory adapters with public `calls` state — no
  network, no MSW, no mocks or spies. Request shapes are **not** tested
  here; those belong in adapter tests.
- `src/store.ts` ↔ `tests/store.test.ts` — public API, memory
  delegation, handle state transitions (IDLE/PENDING/SUCCESS/ERROR),
  handle identity, reactive updates via external `insertDocument`,
  last-write-wins fetch vs mid-flight local insert, error-recovery
  creates a new promise, `clearMemory` handle transitions
- `src/queries.ts` (types only) ↔ `tests/queries.test.ts` — query
  surface on `DocumentStore`: `findQuery` (memory-first, stable-identity
  for deep-equal params, network on miss, ERROR on adapter rejection),
  `insertQueryResult` + `findQueryInMemory` (slot write, deep-equal
  slot, reactive updates), finder pipeline with raw object params
  (dedup by deep-equal, batching, raw params handed to adapter),
  `clearMemory` drops both surfaces, query processors can call
  `insertDocument` to normalize nested entities into the documents cache
- `tests/adapters.test.ts` (no 1:1 source file) — verifies that
  `example-app.ts`'s bulk adapter (`user`) and fan-out adapter (`post`)
  produce the network request shapes they claim. MSW-based. Proves the
  pipeline is agnostic to adapter implementation.
- `src/react/index.ts` ↔ `tests/react/index.test.tsx` —
  DocumentStoreProvider, useDocumentStore, useDocument, useDocuments,
  useQuery, useQueries (loading/success/idle/error), factory isolation
- `src/react/json-api.ts` ↔ `tests/react/json-api.test.tsx` —
  `useBelongsTo` (loading → loaded, memory-first, reactive re-render
  on external insert, null-data idle), `useHasMany` (aggregate
  loading → full list, memory-first, empty-data idle),
  `useHasManyIndividually` (per-item loading/success, memory-first
  per item, per-doc reactive updates, empty-data returns empty array)

Tests share a single `tests/example-app.ts` that demonstrates the full
config surface: `ModelConfig.adapter`, `ModelConfig.processor`,
`DocumentStoreConfig.batchWindowMs`, `DocumentStoreConfig.batchSize`.
Adapters are real fetch-based, intercepted by MSW (`msw/node`). One
bulk + one fan-out + one JSON-API-bulk, so both adapter styles get
coverage.

Before adding implementation, read through these files — the tests
are the source of truth for edge cases this doc doesn't cover.

---

## Reactivity notes

The store is built on `@supergrain/core` signals. Implementation
guidance:

- Internally, memory is one `Map<string, Signal<T | undefined>>` with
  namespaced keys: `"model:<type>:<id>"` for documents,
  `"query:<type>:<stableStringify(params)>"` for queries (see the
  Queries section). The `model:` / `query:` prefix prevents collisions
  when a document type and a query type share a name. `MemoryEngine`'s
  public surface (`insert(type, doc)` / `find(type, id)`) operates on
  the document form; query reads/writes go through
  `DocumentStore.findQuery` / `insertQueryResult`.
- Each `DocumentHandle` internally subscribes to the per-document
  signal for its `(type, id)` via a computed `data` field, and
  propagates changes into its dependent reactive fields.
- `clearMemory` resets all document signals to `undefined` in a
  single batch so dependent scopes re-run once, not N times.

---

## Queries

A second, additive surface on the same `DocumentStore`. Queries are
results keyed by **structured params objects** instead of `id: string`.
Use them for endpoints whose response is meaningful only in the context
of its query params — dashboards, search results, filtered lists,
pagination cursors.

The config surface forks at the top level: `models` for document-keyed
entities, `queries` for params-keyed results. One store, one memory,
one finder; two parallel method families.

```ts
type TypeToModel = { user: User; post: Post };
type TypeToQuery = {
  dashboard: { params: { workspaceId: number }; result: Dashboard };
};

const store = new DocumentStore<TypeToModel, TypeToQuery>({
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
  queries: {
    dashboard: { adapter: dashboardAdapter },
  },
  batchWindowMs: 15,
  batchSize: 60,
});
```

### Second generic, defaults empty

`DocumentStore<M, Q = Record<string, never>>`. Consumers with only
documents pass one generic and see no query surface; the query methods
still exist but constrained to the empty map so `findQuery(...)` is a
type error. The documents API is fully backward-compatible — adding
queries to an existing store is a local change.

### Method parallelism

Documents and queries mirror each other method-for-method:

| Documents                   | Queries                                   |
| --------------------------- | ----------------------------------------- |
| `find(type, id)`            | `findQuery(type, params)`                 |
| `findInMemory(type, id)`    | `findQueryInMemory(type, params)`         |
| `insertDocument(type, doc)` | `insertQueryResult(type, params, result)` |

Same status/promise/data/reactive semantics. The return types
(`DocumentHandle<T>` vs. `QueryHandle<T>`) are structurally identical
— the alias makes call-site types read clearly.

### Cache keying

Memory is one `Map<string, Signal<T>>`, with namespaced keys so
documents and queries can't collide:

- `"model:user:42"` — document slot
- `"query:dashboard:<stableStringify({workspaceId:7,filters:{active:true}})>"` — query slot

Stable stringification sorts object keys recursively before
serializing, so `{a:1,b:2}` and `{b:2,a:1}` hit the same slot.
Stringification is **internal only** — adapters and processors see the
raw params objects.

Supported param types: JSON-serializable values (primitives, plain
objects, arrays). Not supported: Date, Map, Set, class instances,
functions, undefined. Consumers stringify these themselves before
passing.

### Shared finder

One finder handles both documents and queries. The pending queue is
unified: `find(type, id)` and `findQuery(type, params)` calls within
`batchWindowMs` collapse into their respective `adapter.find(...)`
invocations in the same drain cycle. Dedup is per-slot (namespace +
stringified key), so a document `(user, "42")` and a query
`(dashboard, "42")` never conflate.

### QueryAdapter

```ts
interface QueryAdapter<Params> {
  find(paramsList: Array<Params>): Promise<unknown>;
}
```

Structurally identical to `DocumentAdapter` but generic over the params
shape. Same bulk-vs-fan-out agnosticism; the library doesn't inspect
the response.

### QueryProcessor + `defaultQueryProcessor`

```ts
type QueryProcessor<M, Q, Type extends keyof Q & string> = (
  raw: unknown,
  store: DocumentStore<M, Q>,
  type: Type,
  paramsList: ReadonlyArray<Q[Type]["params"]>,
) => void;
```

Same shape as `ResponseProcessor` plus a fourth `paramsList` argument
— the chunk's input params, in the same order the adapter received
them. Processors call `store.insertQueryResult(type, paramsList[i], result)`
to cache results at the right slot.

Query processors can also call `store.insertDocument(...)` to normalize
nested entities into the documents cache. This is the key
cross-surface hook: a `usersByRole` query that fetches users can
insert each user as a document, giving `useDocument("user", id)` reads
elsewhere in the app free cache hits.

`defaultQueryProcessor` handles the simplest case — adapter returns an
array of results aligned 1:1 with `paramsList`; the processor pairs
them by position:

```ts
function defaultQueryProcessor(raw, store, type, paramsList) {
  const results = raw as Array<unknown>;
  for (let i = 0; i < paramsList.length; i++) {
    store.insertQueryResult(type, paramsList[i], results[i]);
  }
}
```

No normalization (nested entities stay in the query result only). For
normalization, write a custom processor.

### React hooks

`useQuery(type, params)` and `useQueries(type, paramsList)` mirror
`useDocument` / `useDocuments`. Same Suspense opt-in (`use(handle.promise)`),
same reactive handle identity, same null-params → idle handle semantics.

### Handle lifecycle

Identical to `DocumentHandle` — `IDLE → PENDING → SUCCESS/ERROR`. The
state machine, promise stability, error-recovery fresh-promise semantics
all apply unchanged.

### When to use which

- **Documents** when the data has identity across queries: entities
  that can be looked up by id and appear in multiple views. User #42
  is the same user whether you fetched them directly or they came back
  in a list.
- **Queries** when the data only makes sense with its params: dashboards,
  search results, paginated cursors, filtered lists. The params are
  the identity.

When in doubt, ask: "Would I ever want `useDocument(type, id)` to share
memory with this?" If yes → document. If no → query.

---

## Non-goals (not in this PR)

- Writes / dispatch / patches / optimistic updates
- Staleness checking / background revalidation
- Imperative `handle.refetch()` API
- Retry with backoff
- Query service implementation (types only)
- Invalidation plumbing from server push
- Devtools integration
- Offline / disk cache tier (intentionally dropped; to be designed
  separately if needed)
- Cancellation of in-flight fetches (e.g. on `clearMemory` or on
  `DocumentStoreProvider` unmount)
- **Auto-suspending hooks.** `useDocument` returns a `DocumentHandle<T>`
  and never throws to Suspense on its own. Suspense is a one-line opt-in
  at the call site (`use(handle.promise)`), not the default. An
  auto-suspending wrapper is a trivial 3-line hook anyone can write on
  top of `useDocument`; going the other direction (recovering the handle
  from an auto-suspending hook) isn't possible. B → A is cheap, A → B is
  impossible, so the primitive is B.
