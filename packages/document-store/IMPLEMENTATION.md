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
- **Stable reactive handles.** Handles are nested in the reactive store
  tree. Fields mutate reactively. No render-cycle identity churn, no
  selector ceremony.

---

## Architecture

The package has two layers:

- `createDocumentStore(config)` — the plain, non-React store primitive.
- `createDocumentStoreContext()` — the React context wrapper that mirrors
  `createStoreContext()` from `@supergrain/react`.

The hook is named `useDocumentStore` (not `useStore`) so it doesn't
collide with the `useStore` from an adjacent `createStoreContext` call
in the same app.

```
┌───────────────────────────────────────────────────────────────┐
│  createDocumentStore<M, Q>(config)                            │
│    returns plain store object                                 │
│                                                               │
│  createDocumentStoreContext<M, Q>()                           │
│    returns { Provider, useDocumentStore,                      │
│              useDocument, useQuery }                          │
│                                                               │
│  Provider init: () => DocumentStore<M, Q>                     │
│    — runs once per Provider mount                             │
│                                                               │
│  The reactive state tree the factory builds:                  │
│    documents: { [type]: { [id]: Handle } }                    │
│    queries:   { [type]: { [paramsKey]: Handle } }             │
│    find, findInMemory, insertDocument,                        │
│    clearMemory,                                               │
│    findQuery, findQueryInMemory, insertQueryResult            │
│                                                               │
│  Finder lives in store creation closure:                      │
│    new Finder<M, Q>(config) — not on the reactive tree        │
└─────────────────────────────┬─────────────────────────────────┘
                              │ delegates fetches (internal)
                              ▼
                  ┌───────────────────────────┐
                  │  Finder (INTERNAL)        │
                  │  batching / chunking      │
                  │  queueDocument / queueQuery│
                  └───────────┬───────────────┘
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

**One reactive store.** The state tree is built once when the Provider
mounts. Documents, queries, and handle fields are all
nested plain objects inside that tree — no per-handle `createReactive`
calls, no separate stores, no memory/handles split. The proxy's
lazy wrapping handles reactivity for nested objects automatically on
read; writes through the proxy fire signals. **Finder** is internal
(not exported) and handles batching/chunking. **Adapter** is a pure
consumer-owned transport. **Processor** is a stateless transform that
calls `store.insertDocument` / `store.insertQueryResult`.

> Naming note: `createDocumentStore` is the plain store primitive.
> `createDocumentStoreContext` is the React wrapper. This mirrors the
> split in `@supergrain/react`: plain primitive first, React context
> wrapper second.

---

## Wiring

`createDocumentStore(config)` builds the plain store object.
`createDocumentStoreContext()` returns the React Provider/hooks bound to
that store type. Provider `init` runs once per mount, so SSR requests
and tests are isolated by construction.

```ts
// services/store.ts
import { createDocumentStore } from "@supergrain/document-store";
import { createDocumentStoreContext } from "@supergrain/document-store/react";
import { jsonApiProcessor } from "@supergrain/document-store/processors/json-api";

export const {
  Provider: DocumentStoreProvider,
  useDocumentStore,
  useDocument,
  useQuery,
} = createDocumentStoreContext<TypeToModel, TypeToQuery>();

function initDocumentStore() {
  return createDocumentStore<TypeToModel, TypeToQuery>({
    models: {
      user: { adapter: userAdapter },
      "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
    },
    queries: {
      dashboard: { adapter: dashboardAdapter },
    },
    batchWindowMs: 15, // optional, default 15
    batchSize: 60,     // optional, default 60
  });
}

// main.tsx
<DocumentStoreProvider init={initDocumentStore}>
  <App />
</DocumentStoreProvider>;
```

`Finder` isn't exported. Consumers tune it through `batchWindowMs` /
`batchSize` in the config passed to `createDocumentStore(...)`.

Public signatures:

```ts
function createDocumentStore<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>>(
  config: DocumentStoreConfig<M, Q>,
): DocumentStore<M, Q>;

function createDocumentStoreContext<
  M extends DocumentTypes,
  Q extends QueryTypes = Record<string, never>,
>(): {
  Provider: (props: { children: ReactNode }) => ReactNode;
  useDocumentStore: () => DocumentStore<M, Q>;
  useDocument: <K extends keyof M & string>(
    type: K,
    id: string | null | undefined,
  ) => DocumentHandle<M[K]>;
  useQuery: <K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ) => QueryHandle<Q[K]["result"]>;
};
```

Compare to `createReactive(...)` + `createStoreContext<T>()` in
`@supergrain/react`: plain primitive first, React context wrapper
second. The store hook is renamed `useDocumentStore` to avoid collision
when both context factories are used in the same app.

---

## Type requirements

Consumer document types need only carry `id: string`. The library keys
every operation by the `type` argument supplied at the API boundary
(`find(type, id)`, `insertDocument(type, doc)`, `findInMemory(type, id)`) —
nothing in the library reads a `type` field off a doc.

```ts
type DocumentTypes = Record<string, { id: string }>;

type TypeToModel = {
  user: { id: string; name: string };
  post: { id: string; title: string };
  "card-stack": { id: string; type: "card-stack"; attributes: { ... } };
  // ^ `type` here is just a convenience for the consumer; the library
  // doesn't read it. JSON-API envelopes supply type inline and
  // jsonApiProcessor reads it from the envelope, not from the cached doc.
};
```

APIs that don't emit `type` on documents (many REST endpoints, custom
formats) work without any wrapper.

---

## The store

Internally `createDocumentStore(config)` builds the plain store object.
`createDocumentStoreContext()` just mounts whatever store object its
Provider `init` returns. That means non-React tests and consumers can
use the same primitive as React apps.

```ts
function createDocumentStore<M extends DocumentTypes, Q extends QueryTypes = Record<string, never>>(
  config: DocumentStoreConfig<M, Q>,
): DocStoreAPI<M, Q> {
  const finder = new Finder<M, Q>(config); // non-reactive, per-mount
  return {
    documents: {},
    queries: {},
    find(type, id) {
      /* ... */
    },
    findInMemory(type, id) {
      /* ... */
    },
    insertDocument(type, doc) {
      /* ... */
    },
    clearMemory() {
      /* ... */
    },
    findQuery(type, params) {
      /* ... */
    },
    findQueryInMemory(type, params) {
      /* ... */
    },
    insertQueryResult(type, params, result) {
      /* ... */
    },
  };
}
```

`DocStoreAPI<M, Q>` is the state shape; `DocStoreState` is its data
portion:

```ts
type DocStoreState<M extends DocumentTypes, Q extends QueryTypes> = {
  documents: { [K in keyof M]?: Record<string, Handle<M[K]>> };
  queries: { [K in keyof Q]?: Record<string, Handle<Q[K]["result"]>> };
};

type DocStoreAPI<M extends DocumentTypes, Q extends QueryTypes> = DocStoreState<M, Q> & {
  find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]>;
  findInMemory<K extends keyof M & string>(type: K, id: string): M[K] | undefined;
  insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void;
  clearMemory(): void;
  findQuery<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"] | null | undefined,
  ): QueryHandle<Q[K]["result"]>;
  findQueryInMemory<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"],
  ): Q[K]["result"] | undefined;
  insertQueryResult<K extends keyof Q & string>(
    type: K,
    params: Q[K]["params"],
    result: Q[K]["result"],
  ): void;
};
```

Handles are plain objects stored at nested positions
(`state.documents[type][id]` / `state.queries[type][paramsKey]`). They
are not separately proxied — the root store proxy's `get` trap
auto-wraps nested plain objects lazily via `proxyCache` (from
`@supergrain/core`), which also guarantees stable identity across reads.
Fields on a handle are regular properties; reads through the store
proxy subscribe, writes fire signals.

`Finder` lives in the init function's closure — one Finder per Provider
mount. It's a class instance, not on the reactive tree, so
`useDocumentStore()` consumers don't see it and nothing subscribes to
its internals.

### Access patterns

- `this.documents[type]?.[id]` — document handle for a key, or
  `undefined` if never created.
- `this.documents[type] ??= {}; this.documents[type][id] = handle;` —
  creates the type bucket lazily on insert.
- `this.queries[type]?.[paramsKey]` — query handle.

Method bodies use `this` (the proxy, bound by JS's normal method-call
semantics) for all state access. No captured store ref inside the init
function — whatever proxy `useStore()` returns is what methods see.

---

## Public method behavior

### `find(type, id | null | undefined) → DocumentHandle<T>`

Returns a **stable, reactive handle**. Same `(type, id)` always returns
the same handle (identity preserved by the proxy's `proxyCache`).

```ts
find<K extends keyof M & string>(type: K, id: string | null | undefined): DocumentHandle<M[K]> {
  if (id == null) return IDLE_HANDLE as DocumentHandle<M[K]>;

  this.documents[type] ??= {};
  let handle = this.documents[type][id];
  if (!handle) {
    handle = {
      status: "IDLE",
      data: undefined,
      hasData: false,
      isPending: false,
      isFetching: false,
      fetchedAt: undefined,
      error: undefined,
      promise: undefined,
    };
    this.documents[type][id] = handle;
  }

  if (handle.status === "IDLE") {
    kickOffDocumentFetch(this, type, id, finder);  // finder from closure
  }
  return handle;
}
```

`IDLE_HANDLE` is a shared, frozen singleton — same object for every
null-id call.

### `findInMemory(type, id) → T | undefined`

Returns `this.documents[type]?.[id]?.data`. Reactive — if the slot is
empty, the read subscribes; a later `insertDocument` re-runs dependent
scopes.

### `insertDocument(type, doc) → void`

Keyed by `(type, doc.id)`. Last-write-wins. Creates the handle if none
exists at the slot.

```ts
insertDocument<K extends keyof M & string>(type: K, doc: M[K]): void {
  this.documents[type] ??= {};
  const existing = this.documents[type][doc.id];

  if (!existing) {
    this.documents[type][doc.id] = {
      status: "SUCCESS",
      data: doc,
      hasData: true,
      isPending: false,
      isFetching: false,
      fetchedAt: new Date(),
      error: undefined,
      promise: Promise.resolve(doc),
    };
    return;
  }

  batch(() => {
    existing.data = doc;
    existing.hasData = true;
    if (existing.status === "ERROR" || existing.status === "IDLE" || existing.status === "PENDING") {
      existing.status = "SUCCESS";
      existing.isPending = false;
      existing.isFetching = false;
      existing.error = undefined;
      existing.promise = Promise.resolve(doc);
      existing.fetchedAt = new Date();
    }
    // Last-write-wins: the fetched value may overwrite the doc we just set.
  });
}
```

### `clearMemory() → void`

Drops data and resets lifecycle on every handle in one `batch()`:

```ts
clearMemory(): void {
  batch(() => {
    for (const typeKey of Object.keys(this.documents)) {
      const bucket = this.documents[typeKey as keyof M];
      if (!bucket) continue;
      for (const id of Object.keys(bucket)) resetHandle(bucket[id]);
    }
    for (const typeKey of Object.keys(this.queries)) {
      const bucket = this.queries[typeKey as keyof Q];
      if (!bucket) continue;
      for (const paramsKey of Object.keys(bucket)) resetHandle(bucket[paramsKey]);
    }
  });
}

function resetHandle(handle: Handle<unknown>): void {
  if (handle.isFetching) {
    // Clear data but leave lifecycle alone — the in-flight fetch will
    // complete and re-populate normally.
    handle.data = undefined;
    handle.hasData = false;
    return;
  }
  handle.status = "IDLE";
  handle.data = undefined;
  handle.hasData = false;
  handle.isPending = false;
  handle.isFetching = false;
  handle.error = undefined;
  handle.promise = undefined;
  handle.fetchedAt = undefined;
}
```

In-flight fetches are not cancelled. When they resolve, the processor's
`insertDocument` calls re-populate the (now cleared) handle normally.

---

## Fetch lifecycle (end-to-end)

Walkthrough of the hot path: what state is written when, where
`batch()` boundaries sit, who owns what. Assume `useDocument("user", "42")`
in a `tracked()` component, first call, cache miss.

**1. Component render.** The hook calls `store.find("user", "42")` and
reads `handle.status` / `handle.data` / etc. Each read subscribes the
tracked scope to that property on the handle — reactive by virtue of
being nested inside the store proxy.

**2. `find` kickoff.**

```ts
function kickOffDocumentFetch<K extends keyof M & string>(
  store: DocStoreAPI<M, Q>, // the proxy (passed as `this` from find)
  type: K,
  id: string,
  finder: Finder<M, Q>,
): void {
  const { promise, resolve, reject } = Promise.withResolvers<M[K]>();
  batch(() => {
    const handle = store.documents[type]![id]!;
    handle.status = "PENDING";
    handle.isPending = true;
    handle.isFetching = true;
    handle.error = undefined;
    handle.promise = promise;
    handle.resolve = resolve;
    handle.reject = reject;
  });
  finder.queueDocument(type, id, store);
}
```

**3. `Finder.queueDocument`.** Pushes `{ surface: "documents", type, id }`
onto its private queue, stashes the store-proxy reference if not already
held, starts `setTimeout(drain, batchWindowMs)` if no drain is pending.

**4. `Finder.drain` (batch window elapsed).** Groups the queue by
surface + type, dedupes keys, chunks at `batchSize`. For a document
chunk:

```ts
async drainDocumentChunk(type, chunkIds) {
  const cfg = this.config.models[type];
  const processor = cfg.processor ?? defaultProcessor;

  let raw: unknown;
  try {
    raw = await cfg.adapter.find(chunkIds);
  } catch (error) {
    this.rejectDocumentChunk(type, chunkIds, error);
    return;
  }

  try {
    batch(() => {
      processor(raw, this.storeRef, type);  // processor writes via insertDocument
      for (const id of chunkIds) {
        const handle = this.storeRef.documents[type]?.[id];
        if (!handle) continue;
        if (handle.hasData) {
          handle.status = "SUCCESS";
          handle.isPending = false;
          handle.isFetching = false;
          handle.fetchedAt = new Date();
          handle.resolve?.(handle.data!);
        } else {
          const err = new Error(`@supergrain/document-store: document not found after fetch: ${type}:${id}`);
          handle.status = "ERROR";
          handle.isPending = false;
          handle.isFetching = false;
          handle.error = err;
          handle.reject?.(err);
        }
        handle.resolve = undefined;
        handle.reject = undefined;
      }
    });
  } catch (error) {
    this.rejectDocumentChunk(type, chunkIds, error);
    return;
  }
}
```

**5. Reactivity fires at batch exit.** All property writes inside the
`batch()` are buffered; at batch exit, subscribers are notified once.
The tracked component re-runs, reads the now-updated fields, and
re-renders.

The promise settles in a microtask after the batch exits, so any
`use(handle.promise)` observer's `then` handlers see the already-flipped
lifecycle.

### Invariants

- **All state writes for one fetch completion live in one `batch()`.**
  The processor writes `handle.data` + `handle.hasData` (via
  `insertDocument`) and the Finder settles `status` / `isPending` /
  `isFetching` / `fetchedAt` in that same outer batch. Subscribers see
  one coherent state change — no transient `PENDING`-with-data frame.
- **Writer ownership:**
  - `find` writes the handle's kickoff state (`status: "PENDING"`,
    `promise`, `resolve`, `reject`).
  - Finder writes the handle's settlement state (`status`, `fetchedAt`,
    `error`, clears resolvers) and calls `resolve` / `reject`.
  - Processors write `handle.data` + `handle.hasData` indirectly, via
    `store.insertDocument`. They do not touch lifecycle fields.
  - External `insertDocument` callers (socket push, test seed) go
    through the store method, which handles both new-handle creation
    and error recovery.
- **One promise per handle.** Created by `Promise.withResolvers()` at
  kickoff, stored as `handle.promise`, settled by the Finder calling
  `handle.resolve` / `handle.reject`. No parallel promise map anywhere.
- **Dedup via handle state.** A second `store.find(type, id)` call
  during an in-flight fetch sees `handle.status === "PENDING"`, skips
  the kickoff, returns the existing handle with its existing promise.

### Query surface

Identical flow with these substitutions:

- Slot: `store.queries[type][paramsKey]` (where
  `paramsKey = stableStringify(params)`).
- Adapter input: `paramsList` instead of `ids`.
- Processor signature: `(raw, store, type, paramsList) => void`.
- Processor writes: `store.insertQueryResult(type, paramsList[i], results[i])`.

`batch()` boundaries, writer ownership, `Promise.withResolvers`, dedup
via handle status — all the same.

---

## Finder (internal)

Not exported. Lives in `src/finder.ts`; constructed inside the
`createDocumentStore` init function (one per Provider mount). Separated
for clarity — batching / chunking has nothing to do with cache storage
or handle lifecycle.

Constructor receives the config and builds:

- `batchWindowMs` (default **15** — roughly one frame / tick; long
  enough to collapse the renders a typical list triggers, short enough
  to not feel laggy).
- `batchSize` (default **60** — fits under common backend `IN`
  clause / query-param limits and avoids URL length issues).

### State

```ts
type QueueEntry =
  | { surface: "documents"; type: string; id: string }
  | { surface: "queries";   type: string; paramsKey: string; params: unknown };

private queue: Array<QueueEntry> = [];
private timer: ReturnType<typeof setTimeout> | undefined;
private storeRef: DocStoreAPI<M, Q> | undefined; // proxy, set on first queue call
```

That's it. No pending promise map — resolvers live on the handle. No
in-flight tracking map — dedup is a read of the handle's own status.

### `queueDocument(type, id, store)` / `queueQuery(type, paramsKey, params, store)`

Pushes one entry onto the queue, stashes the proxy reference, starts
the drain timer if not running. All return `void` — callers already
have the handle and observe completion via `handle.promise` /
`handle.status`.

### Drain

1. Take the queue, group by `(surface, type)`.
2. For each group, chunk at `batchSize`.
3. For each chunk, await `adapter.find(...)`, run the processor, then
   `batch()` per-handle settlement.

### Dedup

No explicit dedup map in the Finder. Dedup happens one layer up: the
second call to `store.find(type, id)` sees a handle with
`status === "PENDING"`, skips kickoff, returns the existing handle. The
Finder's queue therefore never receives duplicates for the same key
within a batch window.

### Retries (NOT in this PR)

Failed adapter calls reject the handles' promises; handles flip to
`ERROR`. No retry. Recovery is via external `insertDocument`.

### Refetching (NOT in this PR)

No `handle.refetch()`. A refetch is observed only as a side-effect of
external `insertDocument` (e.g., socket push, mutation response).

---

## Adapter

```ts
interface DocumentAdapter {
  find(ids: Array<string>): Promise<unknown>;
}
```

Consumer-owned transport. Decides _how_ data gets fetched:

- one bulk GET (`/users?ids=1&ids=2`)
- N parallel single-doc GETs (`Promise.all(ids.map(id => fetch(...)))`)
- websocket request/response
- anything else

The library doesn't inspect the raw response; only the paired processor
does. Adapters reject on network/server errors. The Finder treats any
rejection as a fetch failure for the whole chunk.

---

## Processor

A processor is a **plain function** — no `.process()` method, no class.
Stateless transform; a function is the right primitive.

```ts
type ResponseProcessor<M extends DocumentTypes> = (
  raw: unknown,
  store: DocStoreAPI<M, any>,
  type: keyof M & string,
) => void;
```

Given the raw adapter response, the store, and the type the caller
originally passed to `find(type, id)`, a processor:

1. Parses the raw shape (opaque to the library).
2. Calls `store.insertDocument(type, doc)` for every doc it wants
   cached — primary docs under the fetch type, sideloads under their
   own types.
3. Returns `void`. The Finder's settlement batch reads handle state
   back to determine success/failure per requested id.

### `defaultProcessor` — exported from `/processors`

Used when `ModelConfig.processor` is omitted. Adapter returns a doc or
array of docs; processor inserts each under the caller's `type`.

```ts
function defaultProcessor(raw, store, type) {
  const docs = Array.isArray(raw) ? raw : [raw];
  for (const doc of docs) store.insertDocument(type, doc);
}
```

### `jsonApiProcessor` — exported from `/processors/json-api`

Unwraps `{ data, included }`, inserts every doc keyed by its own `type`
field from the envelope. The `type` argument passed in is ignored —
sideloads span many types unrelated to the fetched one.

Subpath also exports helper types: `Relationship<T>`,
`RelationshipArray<T>`, `JsonApiDocument<Type, Attrs, Rels>`.

### Custom processors

Any function with the `ResponseProcessor<M>` signature. Synchronous;
for async normalization, do it in the adapter before returning.

### Error handling

If the processor throws, the Finder rejects all handles for that chunk
with the thrown error. Same semantics as an adapter rejection.

---

## DocumentHandle

`DocumentHandle<T>` is an **interface** describing the public handle
shape. Internally, each handle is a plain object stored at a nested
position in the store's reactive tree. The public interface omits the
internal settlement hooks (`resolve` / `reject`).

```ts
interface DocumentHandle<T> {
  readonly status: "IDLE" | "PENDING" | "SUCCESS" | "ERROR";
  readonly data: T | undefined;
  readonly hasData: boolean;
  readonly isPending: boolean; // true before first SUCCESS
  readonly isFetching: boolean; // true during any active fetch
  readonly fetchedAt: Date | undefined;
  readonly error: Error | undefined;
  readonly promise: Promise<T> | undefined;
}

// Internal (stored in the tree):
type Handle<T> = DocumentHandle<T> & {
  resolve?: (v: T) => void;
  reject?: (e: unknown) => void;
};
```

All eight user fields are **direct properties** on the handle. No
getters, no `computed`, no derivation at read time. `find` / the Finder
/ `insertDocument` write fields explicitly at each transition. Reads
inside a `tracked()` scope subscribe per-property — a component reading
only `handle.status` re-renders only when `status` flips, not when an
unrelated field changes.

**Stable identity** across reads comes from `@supergrain/core`'s
`proxyCache`: the store proxy's `get` trap lazily wraps nested plain
objects via `createReactiveProxy`, which is a WeakMap-keyed cache. Same
raw handle always produces the same proxy. `store.find("user", "1")`
therefore returns the same reference on every call, from any tracked
or untracked scope.

### Lifecycle

```
IDLE ──(id becomes non-null)────────► PENDING (fetch kicked off)
IDLE ──(insertDocument arrives)─────► SUCCESS (no fetch needed)

PENDING ──(Finder resolves)──► SUCCESS
PENDING ──(Finder rejects) ──► ERROR

SUCCESS ──(new insertDocument with fresher doc)──► SUCCESS (data updated)
ERROR   ──(later insertDocument with valid doc)──► SUCCESS (new promise)

any state ──(clearMemory while not FETCHING)──► IDLE
```

IDLE is one-way under normal operation — once a handle moves off IDLE
it only becomes IDLE again via `clearMemory`. If `clearMemory` fires
on a PENDING handle, the handle stays PENDING; the settlement lands
into the (now cleared) state normally. A subsequent `store.find` call
on an IDLE handle kicks off a fresh fetch (creating a new promise).

### `promise` semantics for React 19 `use()`

- `undefined` while the handle is IDLE.
- Pending on the first fetch.
- Resolves once on success and stays resolved; is not replaced on
  subsequent mutations to `data` via `insertDocument`.
- Rejects once on first error.
- If `insertDocument` lands after an ERROR (recovery path), the handle
  gets a **new** resolved promise so a Suspense boundary inside an
  error boundary can recover.

---

## React binding

`createDocumentStore<M, Q>(init)` returns the Provider plus the React
hooks, all bound to the single store instance created for that Provider
mount. `useDocumentStore()` returns the full reactive state with its
method surface (same role as `useStore` in the base store pattern,
renamed to avoid collision). The document-specific hooks are thin
wrappers that call `useDocumentStore()` and delegate to its methods:

```ts
function useDocument<K extends keyof M & string>(
  type: K,
  id: string | null | undefined,
): DocumentHandle<M[K]> {
  return useDocumentStore().find(type, id);
}

function useQuery<K extends keyof Q & string>(
  type: K,
  params: Q[K]["params"] | null | undefined,
): QueryHandle<Q[K]["result"]> {
  return useDocumentStore().findQuery(type, params);
}
```

No internal subscription machinery. Consumers wrap components in
`tracked()` from `@supergrain/react` — that's the subscription
mechanism. Per-property fine-grained: a component reading only
`handle.status` re-renders only when status flips.

### JSON-API subpath

`useBelongsTo` / `useHasMany` / `useHasManyIndividually` (from
`/react/json-api`) compose on the store's `useDocument` /
`useDocumentStore`. Because they need the hooks, they take a
`useDocumentStore` reference (or the specific single-document hook)
as arguments — or, for the common case, use the default-singleton
exports from the main factory call.

- `useBelongsTo(model, rel)` → `DocumentHandle<T>` via `useDocument`.
- `useHasMany(model, rel)` composes by mapping related ids through
  `useDocumentStore().find(...)`, and can aggregate in user land when a
  single list-level loading state is desired.
- `useHasManyIndividually(model, rel)` → `ReadonlyArray<DocumentHandle<T>>`
  (per-item handles; fetching still batched into one adapter call).

---

## Testing contracts

Failing tests pin the behavior. Source files map to tests (plus two
non-1:1 test files that test integration / adapter behavior):

- `src/memory.ts` ↔ `tests/memory.test.ts` — if the file ends up
  containing just type exports (DocumentTypes, TypeRegistry,
  RegisteredTypes), memory-level tests fold into `store.test.ts`. If
  a thin typed facade survives, the existing tests still apply.
- `src/processors/index.ts` ↔ `tests/processors/index.test.ts` —
  `defaultProcessor` and `defaultQueryProcessor`.
- `src/processors/json-api.ts` ↔ `tests/processors/json-api.test.ts` —
  `jsonApiProcessor`.
- `src/finder.ts` ↔ `tests/finder.test.ts` — batching within a tick
  window, per-type isolation, dedup across concurrent same-id calls,
  chunking, error propagation, adapter-style agnosticism.
- `src/store.ts` ↔ `tests/store.test.ts` — public API, handle state
  transitions (IDLE/PENDING/SUCCESS/ERROR), handle identity, reactive
  updates via external `insertDocument`, last-write-wins fetch vs
  mid-flight local insert, error-recovery creates a new promise,
  `clearMemory` handle transitions.
- `tests/queries.test.ts` — single-query surface.
- `tests/adapters.test.ts` — bulk vs fan-out adapter shapes via MSW.
- `src/react/index.ts` ↔ `tests/react/index.test.tsx` — hooks,
  Provider, factory isolation. Test components wrap in `tracked()`.
- `src/react/json-api.ts` ↔ `tests/react/json-api.test.tsx` —
  `useBelongsTo`, `useHasMany`, `useHasManyIndividually`.

Tests share a single `tests/example-app.ts` with realistic wiring:
real fetch-based adapters, MSW for network, one bulk + one fan-out +
one JSON-API adapter to exercise the full config surface.

React test components use `tracked()` — that's the supergrain
subscription mechanism. Non-React tests exercise the store directly
via its methods and observe state via public reads.

---

## Reactivity notes

The document-store uses the same single-reactive-tree model as the base
store pattern in `@supergrain/react`: one Provider mount creates one
reactive object tree, and the store hook returns that proxy.

- One reactive tree per Provider mount: the state returned by init.
  Documents, queries, and handles all live nested inside it.
- Handles are plain object literals at `state.documents[type][id]` /
  `state.queries[type][paramsKey]`. They are not separately made
  reactive by consumer code. The store proxy's `get` trap wraps them
  lazily on read (via `@supergrain/core`'s `proxyCache`), and that
  wrapping also preserves identity across reads.
- Writes inside the store's methods (called via the proxy; `this`
  bound to the proxy) happen through the proxy's set traps, firing
  per-property signals.
- Multi-field writes at lifecycle transitions are wrapped in `batch()`
  from `@supergrain/core` so subscribers see one coherent state change.
- Settlement hooks (`resolve` / `reject`) live on the handle alongside
  `promise`. They're set at fetch kickoff, called at settlement,
  cleared after. Functions pass through the proxy's `get` trap
  unchanged; nothing subscribes to these fields, so writes are free.
- Components using the hooks wrap in `tracked()` from
  `@supergrain/react`. Per-property fine-grained: a component reading
  only `handle.status` re-renders only when `status` flips.

---

## Queries

A second, additive surface on the same store. Queries are results
keyed by **structured params objects** instead of `id: string`. Use
them for endpoints whose response is meaningful only with its query
params — dashboards, search results, filtered lists, pagination
cursors.

Config forks at the top level: `models` for document-keyed entities,
`queries` for params-keyed results. One store, one reactive tree, one
Finder; two parallel method families.

```ts
type TypeToModel = { user: User; post: Post };
type TypeToQuery = {
  dashboard: { params: { workspaceId: number }; result: Dashboard };
};

export const {
  Provider,
  useDocumentStore,
  useDocument,
  useQuery,
  /* ... */
} = createDocumentStore<TypeToModel, TypeToQuery>(() => ({
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
  queries: {
    dashboard: { adapter: dashboardAdapter },
  },
}));
```

### Second generic, defaults empty

The factory's `Q` generic defaults to `Record<string, never>`.
Consumers with only documents pass one generic and see no query
surface; the documents API is fully backward-compatible.

### Method parallelism

| Documents                   | Queries                                   |
| --------------------------- | ----------------------------------------- |
| `find(type, id)`            | `findQuery(type, params)`                 |
| `findInMemory(type, id)`    | `findQueryInMemory(type, params)`         |
| `insertDocument(type, doc)` | `insertQueryResult(type, params, result)` |

Same status/promise/data/reactive semantics for the single-key methods.
`QueryHandle<T>` is structurally identical to `DocumentHandle<T>`; the
alias makes call-site types read clearly.

### Cache keying

Documents live at `state.documents[type][id]`; queries live at
`state.queries[type][paramsKey]` — separate nested trees, no
possibility of collision.

Stable stringification of params produces `paramsKey`: sorts object
keys recursively before serializing, so `{a:1,b:2}` and `{b:2,a:1}`
hit the same slot. Stringification is **internal only** — adapters
and processors see the raw params objects.

Supported param types: JSON-serializable values (primitives, plain
objects, arrays). Not supported: Date, Map, Set, class instances,
functions, undefined. Consumers stringify these themselves before
passing.

### QueryAdapter

```ts
interface QueryAdapter<Params> {
  find(paramsList: Array<Params>): Promise<unknown>;
}
```

Structurally identical to `DocumentAdapter` but generic over the params
shape.

### QueryProcessor + `defaultQueryProcessor`

```ts
type QueryProcessor<M, Q, Type extends keyof Q & string> = (
  raw: unknown,
  store: DocStoreAPI<M, Q>,
  type: Type,
  paramsList: ReadonlyArray<Q[Type]["params"]>,
) => void;
```

Fourth `paramsList` argument is the chunk's input params in the same
order the adapter received them. Processors call
`store.insertQueryResult(type, paramsList[i], result)`.

Query processors can also call `store.insertDocument(...)` to normalize
nested entities into the documents cache — `usersByRole` fetching
users can insert each user as a document for `useDocument("user", id)`
elsewhere to read.

`defaultQueryProcessor`: adapter returns an array aligned 1:1 with
`paramsList`; processor pairs them by position.

```ts
function defaultQueryProcessor(raw, store, type, paramsList) {
  const results = raw as Array<unknown>;
  for (let i = 0; i < paramsList.length; i++) {
    store.insertQueryResult(type, paramsList[i], results[i]);
  }
}
```

### When to use which

- **Documents** when the data has identity across queries: entities
  looked up by id and appearing in multiple views.
- **Queries** when the data only makes sense with its params:
  dashboards, search results, paginated cursors, filtered lists.

Rule of thumb: "Would I ever want `useDocument(type, id)` to share
memory with this?" If yes → document. If no → query.

---

## Non-goals (not in this PR)

- Writes / dispatch / patches / optimistic updates
- Staleness checking / background revalidation
- Imperative `handle.refetch()` API
- Retry with backoff
- Invalidation plumbing from server push
- Devtools integration
- Offline / disk cache tier
- Cancellation of in-flight fetches
- **Auto-suspending hooks.** `useDocument` returns a `DocumentHandle<T>`
  and never throws to Suspense on its own. Suspense is a one-line
  opt-in at the call site (`use(handle.promise)`), not the default. An
  auto-suspending wrapper is a trivial 3-line hook anyone can write on
  top of `useDocument`; going the other direction (recovering the
  handle from an auto-suspending hook) isn't possible. B → A is cheap,
  A → B is impossible, so the primitive is B.
