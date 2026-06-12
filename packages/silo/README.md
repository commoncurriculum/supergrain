# @supergrain/silo

A reactive document cache for React — Suspense-compatible, request-batched, zero ceremony.

- **Suspense-native** — every handle exposes a stable `promise` for React 19's `use()`. No query keys, no options bags, no `invalidateQueries`.
- **Request batching** — N `useDocument` calls in a render collapse into one `adapter.find(ids)`. No waterfalls.
- **Reactive handles** — `store.find(type, id)` returns a stable object; its fields mutate in place when data lands, when sockets push, when you `insertDocument` locally.
- **Transport-agnostic** — bring your own fetch. Bulk endpoints, fan-out `GET /:id`, websockets, JSON-API envelopes — all work against the same store.
- **Typed by model** — a single `TypeToModel` map drives inference end-to-end; `store.find("user", id)` returns `DocumentHandle<User>` with no casts.

## Install

```bash
pnpm add @supergrain/silo @supergrain/kernel
```

React bindings are optional — `@supergrain/silo/react` requires `react >= 18.2`.

## Quick start

### 1. Define your models and adapters

```ts
// services/store.ts
import { AdapterError, type DocumentAdapter, type DocumentStore } from "@supergrain/silo";
import { createDocumentStoreContext } from "@supergrain/silo/react";
import { Effect } from "effect";

export interface User {
  id: string;
  attributes: { firstName: string; lastName: string };
}
export interface Post {
  id: string;
  attributes: { title: string; body: string };
}

export type TypeToModel = { user: User; post: Post };

const userAdapter: DocumentAdapter = {
  find: (ids, { signal } = {}) =>
    Promise.all(ids.map((id) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()))),
};

const postAdapter: DocumentAdapter = {
  find: (ids, { signal } = {}) =>
    Promise.all(ids.map((id) => fetch(`/api/posts/${id}`, { signal }).then((r) => r.json()))),
};

export const { Provider, useDocumentStore, useDocument } =
  createDocumentStoreContext<DocumentStore<TypeToModel>>();

export const config = {
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
};
```

Adapters above are **fan-out** style — N parallel `GET /:id` requests, merged. Just **return a `Promise`** of whatever the processor can read; the store runs it on its internal [Effect](https://effect.website/) engine (batching, `retry`/`timeout`) and turns a rejection into a typed `AdapterError` for you. The optional `{ signal }` aborts when the adapter Effect is interrupted (e.g. a `timeout` fires); thread it into `fetch` or ignore it. The library doesn't care how you fetch. If your API exposes a bulk endpoint, one `GET` with all the ids works just as well:

```ts
const userAdapter: DocumentAdapter = {
  find: (ids) => fetch(`/api/users?${ids.map((id) => `id=${id}`).join("&")}`).then((r) => r.json()),
};
```

Power users can **return an `Effect`** instead — to own the failure channel, compose custom retries, or manage resources. It's used as-is:

```ts
const userAdapter: DocumentAdapter = {
  find: (ids) =>
    Effect.tryPromise({
      try: () => fetch(`/api/users?${ids.map((id) => `id=${id}`).join("&")}`).then((r) => r.json()),
      catch: (cause) => new AdapterError({ type: "user", keys: ids, cause }),
    }),
};
```

### 2. Mount the Provider

```tsx
// main.tsx
import { Provider, config } from "./services/store";

<Provider config={config}>
  <App />
</Provider>;
```

The Provider wraps `config` in `createDocumentStore()` exactly once per mount, so every SSR request, every test, and every React tree gets an isolated store by construction. You can't accidentally share a store across requests.

For hydration or other one-time setup, pass `onMount`:

```tsx
<Provider
  config={config}
  onMount={(store) => {
    for (const user of window.__HYDRATION__.users) {
      store.insertDocument("user", user);
    }
  }}
>
  <App />
</Provider>
```

`onMount` runs synchronously once per mount, before children render, so seeded data is visible on the initial paint.

### 3. Read documents

```tsx
// UserCard.tsx
import { useDocument } from "./services/store";

export function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);

  if (user.value === undefined) {
    if (user.error) return <ErrorState error={user.error} />;
    return <Skeleton />; // no value yet (pending / fetching)
  }
  return <div>{user.value.attributes.firstName}</div>;
}
```

`useDocument` returns a reactive `DocumentHandle<User>` with flat, orthogonal fields: `value`, `error`, `isFetching`, `fetchedAt`, `failureCount`, `lastError` (plus a derived `status`). They vary independently, so a stale `value` and a fresh refetch `error` coexist instead of clobbering each other. Same `(type, id)` always returns the same handle object across renders, and each field is tracked independently — a component reading only `value` doesn't re-render when a background refetch toggles `isFetching`.

### 4. Or suspend, if you prefer

```tsx
// UserCard.tsx
import { use } from "react";
import { useDocument } from "./services/store";

export function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);
  const value = use(user.promise!); // suspends on first load; never re-suspends on refetch

  return <div>{value.attributes.firstName}</div>;
}
```

Wrap the component in a `<Suspense>` boundary. That's it. One line to opt in, nothing to configure, no `{ suspense: true }` flag.

### Reactive reads + `AbortSignal`

`useDocument` / `useQuery` are **pure reactive reads** — no `useEffect`, no imperative subscription. They just return a reactive handle and re-render on the fields you read.

An in-flight fetch is **not** cancelled when a component unmounts — it completes and populates the shared cache, so the next reader gets it for free. Adapters still receive an optional `{ signal }`: it aborts when the adapter Effect is interrupted (e.g. a per-model `timeout` fires). Thread it into `fetch(url, { signal })` for a real network abort, or ignore it.

The whole engine — batch window included — runs on Effect's clock (`Effect.sleep`), so timing is fully deterministic in tests.

### Updating documents

Stored documents are **live and reactive at field granularity** — the same fine-grained reactivity as the rest of `@supergrain/kernel`. `handle.value` hands back a reactive proxy of the cached object, so reading `handle.value.attributes.firstName` subscribes to _that field_, and there are two ways to update a document — both reactive, no query-key invalidation, no network call:

**1. Mutate a field in place.** Only the readers of that field re-render.

```ts
const user = store.findInMemory("user", "42")!;
user.attributes.firstName = "Ada"; // re-renders only firstName readers
```

**2. Replace the whole document.** Insert a _new_ object; every reader of the document re-renders.

```ts
const prev = store.findInMemory("user", "42")!;
store.insertDocument("user", {
  ...prev,
  attributes: { ...prev.attributes, firstName: "Ada" },
});
```

Reach for in-place when you're editing one field and want the tightest possible re-render; reach for wholesale replace when a socket push or mutation response hands you a fresh object. `insertDocument` writes `handle.value` only when the reference actually changes, so swapping in a new object always notifies, while an in-place field write notifies through that field's own signal.

No copy is made on insert — the object you pass _is_ the cached target, just handed back through a reactive proxy (`unwrap(handle.value)` recovers the exact reference). Documents are **not frozen**: a frozen object is the one thing the kernel hands back _unwrapped_, which would drop it out of the reactive graph — so if you freeze a doc yourself before inserting it, you opt that document out of per-field tracking and in-place updates.

## Why this instead of TanStack Query / SWR?

Short version: the same architecture both libraries wish they had started with.

- **No parallel cache.** Documents live in the same reactive graph as the rest of your state. You read them with the same primitives you use for local state.
- **No query keys.** `(type, id)` _is_ the key. Stable, typed, inferred.
- **Request batching as a primitive.** The thing that makes Suspense actually scale isn't the `use()` hook — it's the batch window that collapses 50 component-level `useDocument` calls into one network request. TQ doesn't do this automatically. Here it's the default.
- **No refetch-on-focus / stale-time matrix.** Deliberately — see non-goals. If you need that complexity, reach for TQ. If you don't, don't pay for it.

For a full capability-by-capability breakdown, trade-offs, and migration guidance, see [Comparison to TanStack Query](#comparison-to-tanstack-query) further down.

## API

### `createDocumentStore<M, Q = Record<string, never>>(config)`

The plain, non-React primitive. It takes config and returns the store object.

```ts
const store = createDocumentStore<TypeToModel>({
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
  batchWindowMs: 15, // default — collapse calls within this window
  batchSize: 60, // default — chunk size per adapter.find() call
});
```

Each model (and query) can also take:

- `processor` (a single step) or `processors` (an ordered pipeline) to turn the adapter's response into store inserts — see [Processors](#processors) below. Omit both and the default processor assumes the adapter returns a doc or an array of docs. Supplying **both** is a configuration error and throws at store creation.
- `retry` — an Effect `Schedule` applied to the adapter Effect on a **retryable** `AdapterError` (e.g. `Schedule.exponential("100 millis").pipe(Schedule.compose(Schedule.recurs(3)))`). An Effect adapter can mark an `AdapterError` `retryable: false` (a deterministic 4xx, say) to fail fast instead of looping.
- `retryable` — a `(error: AdapterError) => boolean` classifier, for **Promise-first** adapters that reject (and so can't set the error's own `retryable` flag). Inspect `error.cause` to veto retries: `(e) => !(e.cause instanceof Response) || e.cause.status >= 500`. An error that opts out via its own `retryable: false` is a hard veto regardless. A veto is **stamped onto the error** (`retryable: false`), so what lands on `handle.error` / `lastError` and the `onError` sink always agrees with the engine's actual decision; the classifier runs exactly once per failed attempt.
- `timeout` — a `Duration` bounding a **single attempt**; on expiry that attempt fails with an `AdapterError`.
- `deadline` — a `Duration` bounding **all attempts together** (including retry backoff); on expiry the whole fetch fails with a non-retryable `AdapterError` tagged `reason: "deadline"`. **On by default**: the built-in `defaultDeadline` (2 minutes) applies whenever no `deadline` is configured, so the infinite default retry always terminates and the handle's promise eventually rejects (Suspense error boundaries fire). Opt out with `deadline: Duration.infinity`. (A per-attempt `timeout` is tagged `reason: "timeout"` — branch on `error.reason` rather than parsing `cause.message`.)
- `isolateFailures` — when a multi-id batch fails terminally, split it and re-fetch the halves to **isolate** the offending id, so one bad record doesn't fail the whole batch and its healthy neighbors still load. Off by default; best for bulk endpoints. The sub-fetches run once (the chunk already exhausted its retry), a `deadline` breach is never bisected, and bisected halves inherit the chunk's **remaining** deadline budget (not a fresh one per recursion level) — the deadline stays the hard stop. Isolation needs a _terminal_ failure to engage, so when no `retry` is configured anywhere an isolating chunk automatically uses a bounded variant of the built-in default (`boundedDefaultRetry`, ~4 attempts); an explicitly configured `retry` — including an explicit `defaultRetry` — is honored as-is.

These resolve per-call ?? store-wide ?? built-in default in one place — `store.resolveAdapterOptions(perCall?)`. Layered packages fetch through **`store.runAdapter(invoke, options)`**, which resolves these knobs, reports every failure to the store's `onError` sink, and counts against `maxConcurrency` — `@supergrain/queries` goes through it, so a query fetch inherits the same resilience as a document `find` by construction.

Store-wide, `DocumentStoreConfig` also takes **`maxConcurrency`** (a positive integer or `"unbounded"`, default `"unbounded"`; anything below 1 is rejected at store creation) — caps how many `adapter.find` **attempts** run at once when a large render produces many chunks. The cap is a per-attempt semaphore, so it composes across batch windows and `isolateFailures` bisection, and a chunk sleeping between retries releases its slot instead of starving healthy chunks. And **`onError`**, an error sink called on **every failed attempt** (not just on give-up) plus terminal `NotFoundError` / `ProcessorError`, with `{ type, keys, attempt, retryable }` — for document fetches, `findQuery` fetches, and `@supergrain/queries` fetches alike. Use `attempt` / `retryable` to chart retry rate or alert only on hard (`retryable: false`) failures.

The built-in default retry (`defaultRetry`) is **jittered** fibonacci (1s base, 0.8–1.2× spread, clamped to 60s), bounded by the built-in default `deadline` of 2 minutes — so out of the box a down backend retries for ~2 minutes (each failed attempt fires `onError` and bumps the handle's `failureCount` / `lastError`, so the outage is observable while retrying), then settles the terminal `error` with `reason: "deadline"`. Tune either side: a finite `Schedule` for fewer attempts, a different `deadline` for a different budget, or `deadline: Duration.infinity` to retry forever.

### Hooks

Store-wide, `DocumentStoreConfig` takes a **`hooks`** object (parallel to `models` / `queries`) for cross-cutting behavior that must run no matter which code path reaches the store. The two hooks bracket **every** `insertDocument(type, doc)` — a direct `store.insertDocument(...)`, a processor insert (including JSON-API `included` sideloads), a Provider `initial` seed, or any future code path. So a shape migration, a defaulted field, or a mirror to another store lives in exactly one place instead of every insertion site.

Both take the **same `(type, doc)` arguments as `insertDocument`** and form a pipeline around it: `prepareInsert → insertDocument → afterInsert`.

- **`prepareInsert(type, doc)`** — a normalization hook that runs on the way _in_; returns the `{ type, doc }` to actually insert.
- **`afterInsert(type, doc)`** — a side-effect observer that runs on the way _out_, after the write is committed.

```ts
const store = createDocumentStore<TypeToModel>({
  hooks: {
    // Card-stacks can arrive as JSON-API `data`, as an `included` sideload, or
    // pushed in directly — these hooks catch them all at the boundary.
    prepareInsert(type, doc) {
      if (doc.archived) return null; // drop — never cache archived docs
      if (doc.type === "card-stack") migrateFromCardsInPlace(doc);
      doc.meta ??= {};
      return { type, doc }; // or just mutate in place and return nothing
    },
    // Bridge every committed Supergrain insert back into the existing Ember store.
    afterInsert: (type, doc) => emberStore.insertDocument(doc),
  },
  models: {
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
});
```

**`prepareInsert`** — normalize **in place** (mutate `doc`) and/or **return a replacement `{ type, doc }` pair** — that pair is what gets inserted. Returning a pair can change _either_ coordinate: a different `doc` (wholesale replace) and/or a different `type` (re-route the document to another bucket). The pair carries `type` explicitly because a silo doc needn't carry its own. Returning nothing (or `undefined`) keeps the original `(type, doc)` with the (possibly mutated) `doc`, mirroring the `?? response` pass-through of a [processor](#processors) — so the common "mutate in place" case needs no return. Returning **`null` vetoes the insert** — the document is dropped and nothing is written, the place to filter records that should never enter the cache. It runs _before_ the doc is wrapped in the reactive proxy, so in-place edits notify no subscribers. When your models share a literal `type` discriminant, branch on `doc.type` to narrow; otherwise branch on the `type` argument (for models whose documents don't carry their own type). One caveat on re-routing: when a `store.find(type, id)` drove the insert, the handle is settled by looking the doc up under the _requested_ type — re-route to a different type and that handle settles as `NotFound`, so re-route deliberately.

**`afterInsert`** — runs once per committed document, _after_ the reactive write has flushed (cache settled, subscribers notified). It receives the final `(type, doc)` actually written — the post-`prepareInsert` pair, re-routing included (the `doc` is identical to `unwrap(store.findInMemory(type, doc.id))`); its return value is ignored. Use it for side effects: mirror the document into another store, update a derived index, emit telemetry. It does **not** run when `prepareInsert` vetoes the insert (there's nothing to observe). Calling `store.insertDocument(...)` from inside it funnels back through the same hooks — fine for cascading related records, but mind the recursion.

Both hooks cover documents only (`insertDocument`); query results (`insertQueryResult`) are not run through them.

Methods:

- `find(type, id)` → `DocumentHandle<T>`
- `findInMemory(type, id)` → `T | undefined`
- `insertDocument(type, doc)` → `void`
- `clearMemory()` → `void`
- `findQuery(type, params)` → `QueryHandle<T>`
- `findQueryInMemory(type, params)` → `T | undefined`
- `insertQueryResult(type, params, result)` → `void`
- `resolveAdapterOptions(perCall?)` → `{ retry, retryIsDefault, timeout, deadline, retryable, onError }` — merge per-call overrides over the store-wide defaults, with the store's `onError` sink passed through so layered helpers can report failures that happen outside the engine (in-engine failures are reported automatically by `store.runAdapter`); `retryIsDefault` is true when `retry` is the built-in fallback rather than anything configured

### `createDocumentStoreContext<S extends DocumentStore<any, any>>()`

The React context wrapper. Mirrors `createStoreContext<T>()` from `@supergrain/kernel/react`: the type parameter `S` is the store type; the Provider takes the same `config` you'd pass to `createDocumentStore()` and constructs the store internally once per mount.

```ts
type DocStore = DocumentStore<TypeToModel, TypeToQuery>;

const { Provider, useDocumentStore, useDocument, useQuery } =
  createDocumentStoreContext<DocStore>();

<Provider config={{ models, queries }} onMount={(store) => seed(store)}>
  <App />
</Provider>
```

For non-React use, import `createDocumentStore` directly from `@supergrain/silo`.

### `DocumentHandle<T, E = SiloError>`

A reactive handle for a single document — a `status`-discriminated union over flat fields, each tracked independently inside a `tracked()` scope.

```ts
type DocumentHandle<T, E = SiloError> =
  | {
      status: "pending";
      value: undefined;
      error: undefined;
      fetchedAt: undefined;
      isFetching: boolean;
      failureCount: number; // failed attempts this cycle
      lastError: E | undefined; // latest attempt error while retrying
      promise: Promise<T> | undefined;
    }
  | {
      status: "success";
      value: T;
      error: E | undefined;
      fetchedAt: Date; // refetch error coexists
      isFetching: boolean;
      failureCount: number;
      lastError: E | undefined;
      promise: Promise<T> | undefined;
    }
  | {
      status: "error";
      value: undefined;
      error: E;
      fetchedAt: undefined;
      isFetching: boolean;
      failureCount: number;
      lastError: E | undefined;
      promise: Promise<T> | undefined;
    };
```

Narrowing on `status` (or on `value !== undefined`) refines `value` to `T`. The fields still vary independently, so all states are representable — including a `value` present alongside a refetch `error` (stale data + refetch error), which a single flat status enum couldn't express: that's the `success` arm with `error` set. `status` stays `"success"` across a refetch (the orthogonal `isFetching` flips instead), so narrowing on it never adds a re-render. `value: undefined` is the not-loaded sentinel — a loaded-but-`null` value is `status: "success"` with `value: null`, distinct from `pending`. There is no separate "idle" status (earlier versions had `"IDLE"`): a not-yet-started handle is `status: "pending"` with `isFetching: false`, and a first load in flight is `status: "pending"` with `isFetching: true` — "has a fetch started" lives on the `isFetching` axis, not in `status`.

`failureCount` / `lastError` make a _retrying_ fetch observable separately from a _terminal_ one. While `retry` keeps re-attempting, `error` stays unset (no give-up yet) but each failed attempt bumps `failureCount` and records `lastError` — so under the infinite default retry a down backend shows climbing failures and the latest cause instead of a silent spinner. They reset to `0` / `undefined` the moment an attempt succeeds; on terminal failure `lastError` equals `error`.

`clearMemory()` clears `value`/`error`/`fetchedAt` (an in-flight fetch survives and repopulates). Errors are typed: `AdapterError` (adapter failed), `NotFoundError` (key absent after fetch), `ProcessorError` (processor threw) — union `SiloError`.

### React hooks

From `@supergrain/silo/react`:

All returned from `createDocumentStoreContext<S>()`; destructure and re-export from your store module.

- `Provider({ config, initial?, onMount?, children })` — wraps `config` in `createDocumentStore()` exactly once per mount. Optional `initial` seeds documents/query results before the first render; optional `onMount` runs synchronously after seeding for imperative setup.
- `useDocument(type, id | null | undefined)` → `DocumentHandle<T>`. `null`/`undefined` id returns an idle handle (useful for conditional fetching — `useDocument("user", isLoggedIn ? myId : null)`). "Idle" isn't a separate `status`: the handle reads `status: "pending"` with `isFetching: false` (detect it as `status === "pending" && !isFetching` if you need to). There's no `"IDLE"` status — it folded onto the orthogonal `isFetching` axis.
- `useDocumentStore()` → store API. Escape hatch for imperative ops (`insertDocument`, `clearMemory`, query methods).
- `useQuery(type, params | null | undefined)` → `QueryHandle<Result>`. Same null-handling as `useDocument`.
- For lists, call `useDocumentStore().find(type, id)` for each id. Batching still happens under the hood; the public primitive stays one resource → one handle.

### Factory for isolated stores

Most apps create one document-store context in their app wiring. Libraries shipping their own document store, micro-frontends, or test harnesses that need isolated instances create their own separate context call:

```ts
import { type DocumentStore } from "@supergrain/silo";
import { createDocumentStoreContext } from "@supergrain/silo/react";

const libStore = createDocumentStoreContext<DocumentStore<LibTypes>>();
export const { Provider, useDocument, useDocumentStore } = libStore;

export const libConfig = {
  models: {
    /* ... */
  },
};
```

The returned Provider/hooks are bound to that specific context factory call. Each `<Provider config={libConfig}>` mount constructs its own store, so two trees mounted side-by-side don't share memory.

## Batching, in detail

The Finder is internal — you never construct or import it — but it's what makes the whole thing feel native. Given this tree:

```tsx
<Suspense fallback={<Loading />}>
  {userIds.map((id) => (
    <UserCard key={id} id={id} />
  ))}
</Suspense>
```

…where each `UserCard` calls `useDocument("user", id)` and `use(user.promise)`, here's what happens:

1. Every hook call lands in a pending queue keyed by `(type, id)`.
2. A 15ms timer starts on the first call; further calls in that window join the queue.
3. When the timer fires, ids are deduped, chunked at `batchSize`, and handed to `adapter.find(ids)` — one call per chunk, per type.
4. The processor inserts each returned doc. Every handle waiting on a `(type, id)` whose doc arrived resolves; its Suspense boundary unblocks.

50 `<UserCard>`s → one `/api/users?id=1&id=2&…&id=50` call. Same mechanism works for JSON-API sideloads — if the `user` response includes a related `organization`, the processor inserts both, and any `useDocument("organization", …)` already in flight resolves for free.

## Processors

The adapter returns whatever its fetch chain returns — typically already-parsed JSON. A processor takes that parsed response and calls `store.insertDocument(type, doc)` for every document worth caching.

Processors are an **ordered response pipeline.** The adapter returns a response. Silo passes that response through each processor in order. A processor may mutate the response, return a replacement response, perform side effects, or insert documents into the store. If it returns `undefined` (or `null`), the current response continues to the next processor. Most pipelines end with an insertion processor.

Configure a single step with `processor`, or an ordered array with `processors`:

```ts
createDocumentStore<TypeToModel>({
  models: {
    "card-stack": {
      adapter: cardStackAdapter,
      processors: [
        migrateCardStackResponse(), // mutate fetched docs in place
        mirrorResponseDocumentsToEmber(emberStore), // side effect: hydrate another store
        jsonApiProcessor, // insert into silo
      ],
    },
  },
});
```

That reads in execution order: fetch card stacks → migrate the response docs → mirror them into the other store → insert them into silo. `processor` and `processors` are mutually exclusive — supplying both throws at store creation. `{ adapter }`, `{ adapter, processor: defaultProcessor }`, and `{ adapter, processors: [defaultProcessor] }` are all equivalent.

Processors are **keyed by envelope shape, not by model.** One processor normally serves many adapters: every REST endpoint that returns `{id, ...}` or `[{id, ...}, ...]` shares `defaultProcessor`; every JSON-API endpoint in your app shares `jsonApiProcessor`; a custom `graphqlProcessor` would serve every GraphQL-returning adapter. The per-model `processor` field isn't one-per-adapter — it's "which envelope parser does this adapter's response need."

### Default

If no processor is configured, the library uses `defaultProcessor` — fits any REST endpoint that returns a doc or an array of docs with no wrapping envelope.

You call:

```tsx
const post = useDocument("post", "1");
```

Internally, the store's finder calls your adapter with the queued ids, expecting a shape the default processor understands:

```ts
// finder runs the Effect from adapter.find(ids); expects either a single doc or an array
adapter.find(["1", "2"]); // Effect that produces:
// → [{ id: "1", ... }, { id: "2", ... }]
// or for a single id:
adapter.find(["1"]); // Effect that produces:
// → { id: "1", ... }
```

`defaultProcessor` then inserts each doc under the caller's type using the doc's own `id`. No envelope, no sideloading, no type-on-doc requirement.

### JSON-API

For consumers whose API speaks JSON-API. Opt in per-model:

```ts
import { jsonApiProcessor } from "@supergrain/silo/processors/json-api";

createDocumentStore<M>({
  models: {
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
});
```

You call:

```tsx
const cardStack = useDocument("card-stack", "42");
```

Internally, the finder calls your adapter, expecting a JSON-API envelope:

```ts
adapter.find(["42"]); // Effect that produces:
// → {
//     data: [
//       { type: "card-stack", id: "42", attributes: { ... },
//         relationships: { planbook: { data: { type: "planbook", id: "7" } } } },
//     ],
//     included: [
//       { type: "planbook", id: "7", attributes: { ... } },
//     ],
//   }
```

`jsonApiProcessor` inserts every document in `data + included`, keyed by each doc's own `type` field from the envelope (JSON-API requires every resource object to carry one). Sideloaded documents drop into their respective caches automatically — so in the example above, `useDocument("planbook", "7")` elsewhere in the tree resolves for free, no extra fetch.

JSON-API relationship hooks live in a separate subpath:

```ts
import { useBelongsTo, useHasMany } from "@supergrain/silo/react/json-api";

const planbook = useBelongsTo(cardStack, "planbook");
const cards = useHasMany(planbook.value ?? null, "cards");
```

- `useBelongsTo(model, relationName)` → `DocumentHandle<Related>`. Reads `model.relationships[relationName].data` (a `{ type, id }`), then delegates to `useDocument`.
- `useHasMany(model, relationName)` → `ReadonlyArray<DocumentHandle<Related>>`. One handle per related doc; fetching is still batched into one adapter call.
- `useHasManyIndividually(model, relationName)` → `ReadonlyArray<DocumentHandle<Related>>`. Same per-doc shape with a name that makes the item-by-item semantics explicit.

### Custom

A processor is any function matching `(response, context) => unknown | void`, where `context` is `{ store, type, ids }`:

```ts
import { type ResponseProcessor } from "@supergrain/silo";

// Transform: return a replacement response for the next step.
const normalize: ResponseProcessor<TypeToModel> = (response) => {
  for (const doc of responseDocs(response)) migrateInPlace(doc);
  return response;
};

// Insert: the terminal step. Returns nothing — silo reads each requested
// (type, id) from memory afterward to settle the handle.
const insert: ResponseProcessor<TypeToModel> = (response, { store, type }) => {
  for (const doc of responseDocs(response)) store.insertDocument(type, doc);
};
```

Returning a value replaces the response handed to later processors; returning `undefined` (or `null`) passes the current response through unchanged. (Pass-through uses `??`, so `null` can't be used to replace the response.) If you need GraphQL, a REST envelope, or a bespoke wire format — write one. Processors are synchronous; for async normalization, do it in the adapter. If a processor throws, the remaining processors don't run and the fetch fails with a `ProcessorError` — the same terminal behavior as a single-`processor` throw.

## Queries

Documents are one surface. The store has a second, additive surface: **queries** — results keyed by structured params objects instead of `id: string`. Use them for endpoints whose response is only meaningful with its query params: dashboards, search results, filtered lists, pagination cursors.

The config surface forks at the top level — `models` for documents, `queries` for params-keyed results. One store, one memory, one finder.

```ts
import { AdapterError, createDocumentStore, type QueryAdapter } from "@supergrain/silo";
import { Effect } from "effect";

type TypeToModel = { user: User; post: Post };

type TypeToQuery = {
  dashboard: { params: { workspaceId: number }; result: Dashboard };
};

const dashboardAdapter: QueryAdapter<{ workspaceId: number }> = {
  find: (paramsList) =>
    Effect.tryPromise({
      try: () =>
        Promise.all(
          paramsList.map((p) => fetch(`/api/dashboard?ws=${p.workspaceId}`).then((r) => r.json())),
        ),
      catch: (cause) => new AdapterError({ type: "dashboard", keys: [], cause }),
    }),
};

const store = createDocumentStore<TypeToModel, TypeToQuery>({
  models: {
    user: { adapter: userAdapter },
    post: { adapter: postAdapter },
  },
  queries: {
    dashboard: { adapter: dashboardAdapter },
  },
});
```

Consumers with only documents pass one generic and omit `queries`. The second generic defaults to an empty query map.

### Reading queries

Parallel to `useDocument`/`useDocumentStore.find`:

```tsx
import { useQuery } from "@supergrain/silo/react";

function DashboardView({ workspaceId }: { workspaceId: number }) {
  const handle = useQuery("dashboard", { workspaceId });

  if (handle.value === undefined) {
    if (handle.error) return <ErrorState error={handle.error} />;
    return <Skeleton />;
  }
  return <Dashboard data={handle.value} />;
}
```

Same `QueryHandle<T>` shape as `DocumentHandle<T>` — flat `value` / `error` / `isFetching` / `fetchedAt` / `failureCount` / `lastError` / `status` plus `promise`. Same Suspense opt-in via `use(handle.promise)`. Same stable handle identity, so two components requesting `{ workspaceId: 7 }` get the same reactive object.

Object key identity is **deep-equal**: `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hit the same slot. The library stable-stringifies for cache lookup; adapters see the raw objects.

### Method mirror

| Documents                         | Queries                                         |
| --------------------------------- | ----------------------------------------------- |
| `store.find(type, id)`            | `store.findQuery(type, params)`                 |
| `store.findInMemory(type, id)`    | `store.findQueryInMemory(type, params)`         |
| `store.insertDocument(type, doc)` | `store.insertQueryResult(type, params, result)` |
| `useDocument(type, id)`           | `useQuery(type, params)`                        |

### Two ways to handle a list query

Take `GET /api/users?role=admin`. It's a query (keyed by params), and it returns a list of users. There are two reasonable ways to cache it — pick based on whether you need normalization.

#### Option A — plain: store the response as-is (default processor)

Declare the query result as the whole user list. No custom processor needed.

```ts
type TypeToQuery = {
  usersByRole: { params: { role: string }; result: User[] };
};

const usersByRoleAdapter: QueryAdapter<{ role: string }> = {
  find: (paramsList) =>
    Effect.tryPromise({
      try: () =>
        Promise.all(
          paramsList.map((p) => fetch(`/api/users?role=${p.role}`).then((r) => r.json())),
        ),
      catch: (cause) => new AdapterError({ type: "usersByRole", keys: [], cause }),
    }),
};

createDocumentStore<TypeToModel, TypeToQuery>({
  models: { user: { adapter: userAdapter } },
  queries: {
    usersByRole: { adapter: usersByRoleAdapter }, // defaultQueryProcessor
  },
});
```

Usage:

```tsx
const query = useQuery("usersByRole", { role: "admin" });
return query.value?.map((u) => <UserRow key={u.id} user={u} />) ?? null;
```

What this gives you: 10 lines of config, works immediately, automatic batching of concurrent queries, Suspense-compatible.

What you give up: **no normalization.** The users cached under this query slot are a separate copy from users cached as documents. If someone else calls `store.insertDocument("user", updated42)` — from a detail page load, a socket push, a mutation response — this list keeps showing the old copy of user #42 until the query is re-fetched. Same user, multiple copies, drift.

This is fine when:

- The query result is short-lived or one-shot
- Users showing in this list aren't shown anywhere else
- You're okay re-fetching to see fresh data

#### Option B — normalized: extract documents, store an id-list

Write a custom processor that pulls each user out into the documents cache and stores only a list of ids under the query slot.

```ts
type TypeToQuery = {
  usersByRole: { params: { role: string }; result: { userIds: string[] } };
};

const usersByRoleProcessor: QueryProcessor<TypeToModel, TypeToQuery, "usersByRole"> = (
  response,
  { store, type, paramsList },
) => {
  const results = response as Array<User[]>; // adapter returns one User[] per params
  for (let i = 0; i < paramsList.length; i++) {
    const users = results[i];
    // Normalize: insert each user into the documents cache
    for (const u of users) store.insertDocument("user", u);
    // Store only the id-list as the query result
    store.insertQueryResult(type, paramsList[i], { userIds: users.map((u) => u.id) });
  }
};

createDocumentStore<TypeToModel, TypeToQuery>({
  models: { user: { adapter: userAdapter } },
  queries: {
    usersByRole: { adapter: usersByRoleAdapter, processor: usersByRoleProcessor },
  },
});
```

Usage:

```tsx
const query = useQuery("usersByRole", { role: "admin" });

// Dereference each id — each row gets its own reactive handle
return query.value?.userIds.map((id) => <UserRow key={id} id={id} />) ?? null;
```

What this gives you:

- **One cache entry per user.** Same user shows up in the admin query, the detail page, a sidebar — one reactive object, no drift.
- **Mutations radiate.** `store.insertDocument("user", updated42)` re-renders every view referencing user #42, including this list. No query-cache invalidation, no network call.
- **Small query slot.** Just `{ userIds: [...] }`, not fat user payloads.
- **Cross-query sync.** Another query that returned the same user reads from the same slot; edits propagate everywhere.

What you give up: ~15 extra lines per list-query type for the processor.

This is what Relay and Apollo do with GraphQL schemas; queries here express the same pattern without the schema machinery.

#### Picking between them

Plain → normalized is a local change (swap the result type, add a processor, deref ids instead of users). Start plain, move to normalized when the duplication bites. You don't have to get it right on day one.

### Default query processor

If `QueryConfig.processor` (and `processors`) is omitted, the library uses `defaultQueryProcessor` — assumes the adapter returns an array of results aligned 1:1 with the input params, and pairs them by position:

```ts
// adapter returns: [resultForParams0, resultForParams1, ...]
// → insertQueryResult(type, paramsList[i], results[i]) for each
```

No normalization (nested entities stay inside the query result). For normalization, write a custom processor as shown above.

Queries support the same **ordered pipeline** as documents — supply `processors: [...]` instead of a single `processor` to compose response steps in execution order. A query processor is `(response, context) => unknown | void`, where `context` is `{ store, type, paramsList }` (`paramsList` in place of a document processor's `ids`). The same rules apply: returning a value replaces the response for later steps, returning `undefined` passes it through, a throw stops the pipeline with a `ProcessorError`, and supplying both `processor` and `processors` throws at store creation.

### When to use which

- **Documents** when the data has identity across contexts: entities looked up by id and shared across views. User #42 is the same user whether fetched directly or in a list.
- **Queries** when the data only makes sense with its params: dashboards, search results, pagination cursors, filtered lists. The params _are_ the identity.

Rule of thumb: "Would I ever want `useDocument(type, id)` to read from this cache slot?" If yes → document. If no → query.

## Comparison to TanStack Query

TanStack Query (TQ) and SWR make similar bets; TQ is more feature-complete, so this comparison uses it as the stand-in.

### The architectural difference

Both libraries cache async data, but they make opposite choices about what the cache _is_.

**TQ: opaque caching.** The cache is keyed by an arbitrary `queryKey` array. The library has no idea what's inside a response — a user in the list query and the same user in the detail query are separate cache entries. Simple mental model; no schema needed. Cost: data duplicates across queries, cross-query sync requires manual `setQueryData`, invalidation is pattern-matching across keys.

**document-store: normalized caching.** Responses aren't opaque — the processor knows what types/ids live inside and scatters them into per-`(type, id)` slots. User #42 lives in one place; every view that references them reads the same reactive object.

These aren't "same library, different maturity" — they're genuinely different bets. TQ refuses to normalize because it complicates the mental model. document-store embraces it for the payoff: automatic cross-query sync without explicit invalidation.

### Capability comparison

| Capability                                             | TQ (today) | document-store (today) | document-store (ceiling)                       |
| ------------------------------------------------------ | :--------: | :--------------------: | ---------------------------------------------- |
| Fetch by id                                            |     ✓      |           ✓            | —                                              |
| Fetch by arbitrary query                               |     ✓      |           ✗            | generalize adapter keys                        |
| Request dedup                                          |     ✓      |           ✓            | —                                              |
| **Multi-key batching into one request**                |     ✗      |           ✓            | —                                              |
| **Stable-id normalization**                            |     ✗      |           ✓            | —                                              |
| **Cross-query sync (edit user → every view updates)**  | ✗ (manual) |           ✓            | —                                              |
| **Stable reactive handles (fine-grained field reads)** |     ✗      |           ✓            | —                                              |
| Suspense via `use()`                                   | ✓ (opt-in) |       ✓ (opt-in)       | —                                              |
| Invalidation                                           |     ✓      |           ✗            | add `invalidate` / `invalidateType`            |
| Stale-time / gc-time                                   |     ✓      |           ✗            | add `staleMs`; compare against `fetchedAt`     |
| Refetch on focus / reconnect / interval                |     ✓      |           ✗            | add opt-in hooks                               |
| Retry with backoff                                     |     ✓      |           ✓            | — (jittered fibonacci default; configurable)   |
| Cancellation                                           |     ✓      |           ✓            | — (adapter `AbortSignal`; not on unmount)      |
| Pagination / infinite queries                          |     ✓      |           ✗            | `@supergrain/queries` (shipped)                |
| Mutations + optimistic + rollback                      |     ✓      |           ✗            | next-PR write layer built on `insertDocument`  |
| SSR / hydration                                        |     ✓      |           ✗            | serialize the store's reactive tree, rehydrate |
| Persistence (localStorage / IDB)                       |     ✓      |           ✗            | serialize map on write, restore on init        |
| Devtools                                               |     ✓      |           ✗            | expose cache map + event stream                |
| Ecosystem / community / docs                           |   Large    |         Small          | —                                              |

**Bold rows are architectural** — they live in the primitive and can't be retrofitted without a rewrite. Everything else is **additive**: bolt-on features that land without touching core design. The "ceiling" column is the planned-additive path; none of it requires architectural change to get to.

### What we give up vs TQ

- **Shipped feature count.** TQ has years of polish; we're shipping a read layer. If you need stale-time, refetch-on-focus, or mutations _today_, TQ wins. (Retry/backoff, cancellation, and pagination have since landed — pagination ships separately in [`@supergrain/queries`](../queries/README.md).)
- **Partial-key pattern invalidation.** `invalidateQueries({ queryKey: ['users'] })` in TQ matches every key starting with `['users']`. Our planned `invalidateType('users-by-role')` is blunter — drops everything under a type in one call. Predicate invalidation (`invalidateWhere`) handles the precise cases. Net: ~5% of real-world invalidation needs are less ergonomic.
- **Zero-discipline fetching.** Write `queryFn` and you're done. Here you write adapter + processor + provider wiring. More up-front work; pays off if normalization matters to you.
- **Mature ecosystem.** Persisters, devtools, SSR integrations, community plugins.

### What TQ gives up vs document-store

- **Cross-query sync without manual wiring.** Edit user #42 with `insertDocument("user", updated42)` — every list, detail view, and relationship re-renders instantly, no network call. TQ needs pattern invalidation precisely _because_ it doesn't normalize; each query has its own copy of the data that drifts.
- **Request batching.** 50 `<UserCard id={x} />` components collapse into one network request. TQ has no equivalent built into the primitive.
- **One cache, not two.** TQ almost always sits beside Zustand/Redux/etc. — two caches to reconcile. Our store is both.
- **Fine-grained reactivity.** Reading `handle.value` re-renders only when the value changes, not when a background refetch toggles `handle.isFetching`. TQ returns a new `{data, isLoading, error}` object every render — whole-handle subscription only, no field-level reads.
- **Simpler invalidation model.** Normalization + reactive propagation handles most of what pattern invalidation exists to solve. You don't need an invalidation graph if mutations just write to the store.

### When to pick which

- **Pick TQ today** if you need stale-time, refetch-on-focus, or mutations _shipping now_. If "opaque cache, refetch on events" fits your mental model and you don't want to think about normalization. If your queries don't overlap enough for cross-query sync to matter.
- **Pick document-store** if you want fine-grained reactive state as your primary model and documents should be part of that. If cross-query sync would meaningfully simplify your app (entity updates radiating without keys). If you're okay being on a library with a smaller feature surface today, trusting that the additive features will land.
- **Use both in one app during migration.** Totally viable. TQ for search/list/cursor queries where opacity is fine; document-store for entity reads that benefit from normalization. They don't step on each other.

### Honest caveat

Much of the comparison above contrasts TQ-as-shipped with document-store-as-designed. Some rows (generalized keys, invalidation, mutations) are planned-additive and not in this PR. The _foundation_ is the hard part; those features are ~10-50 LOC each on top. If you're evaluating for a production migration _today_, weight the "today" column, not the "ceiling" column.

## Non-goals (in this version)

These are deliberate — every one was considered and left out for this read layer. Most will land in subsequent packages / PRs.

- Writes, dispatch, optimistic updates — a separate write layer will build on this.
- Stale-time / refetch-on-focus / background revalidation.
- Imperative `handle.refetch()` on a document — observe fresh data by calling `insertDocument` from a socket handler or a mutation response. (Paginated queries in [`@supergrain/queries`](../queries/README.md) do expose `refetch()` / `fetchNextPage()`.)
- Server-push invalidation for individual documents — push fresh data with `insertDocument` instead. ([`@supergrain/queries`](../queries/README.md) adds an opt-in `subscribe` hook for paginated queries.)
- Unmount-driven cancellation — an in-flight fetch completes and populates the cache even after its component unmounts. Adapters still receive an `AbortSignal` that fires on `timeout` / `deadline` / interrupt, so request cancellation itself is supported.
- **Auto-suspending hooks.** `useDocument` returns a handle; it never throws to Suspense on its own. Suspense is a one-line opt-in (`use(handle.promise)`). The reverse — recovering a handle from an auto-suspending hook — isn't possible, so the primitive stays non-suspending and auto-suspend is a trivial wrapper anyone can write.

## License

MIT
