# @supergrain/queries

Pagination + live-subscription queries for [`@supergrain/silo`](../silo/README.md). A reactive `createQuery` handle that pages through a resource, merges each page into the store, and refetches when the server says the results are stale — running on the **same Effect engine** as a silo document fetch.

- **Paginated** — `fetchNextPage()` merges pages by server-provided offset; `refetch()` replaces from page 0.
- **Lives in the store** — results, the next-page cursor, and sideloaded `included` docs are written into your `DocumentStore`, so they're reactive and normalized alongside everything else.
- **Same resilience as a document fetch** — `retry` / `timeout` / `deadline` / `retryable` resolve through the store exactly like a `ModelConfig`; failures report to the store's `onError` sink and count against `maxConcurrency`.
- **Single-flight** — a `refetch()` interrupts any in-flight fetch (aborting its adapter `signal`); `fetchNextPage()` instead waits for one, so a fresher page 0 is never silently dropped.
- **Live, opt-in** — pass a `subscribe` hook (typically your socket transport); when the server signals staleness, the query refetches from offset 0.

## Install

```bash
pnpm add @supergrain/queries @supergrain/silo @supergrain/kernel effect
```

`effect` is a peer dependency of `@supergrain/silo` and `@supergrain/queries` — install it alongside (shown above). It's the engine silo runs on; you don't have to write any Effect yourself.

## Why a separate package?

`@supergrain/silo` caches one response per `(type, id)` document or `(type, params)` query — perfect for entities and one-shot results. Some resources have a different shape: an **append-only, paginated feed** that grows as you scroll and goes stale when the server pushes an update — a user's planbooks, a search result set, an activity stream. `@supergrain/queries` is the primitive for that shape. It accumulates the pages in a single store slot and hands back a reactive handle to drive it, reusing silo's fetch engine rather than re-implementing retries, abort, and telemetry.

## Usage

A query result is stored as one `(type, id)` slot whose value is a `QueryModel` — the accumulated `results` plus the next-page cursor. Declare that slot in your store's `DocumentTypes`, then drive it with `createQuery`.

```ts
import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { createQuery, type QueryAdapter, type QueryModel } from "@supergrain/queries";

// Each result item carries its own server-assigned `offset` (stable positioning
// across pages).
interface PlanbookRef {
  type: "planbook";
  id: string;
  offset: number;
}

type Models = {
  // The query slot: its value is a QueryModel of PlanbookRefs, keyed by user id.
  planbooks_for_user: QueryModel<"planbooks_for_user", PlanbookRef>;
  // A normal document — sideloaded by the query's `included`, readable directly.
  planbook: { id: string; type: "planbook"; title: string };
};

const store: DocumentStore<Models> = createDocumentStore<Models>({
  models: {
    // `createQuery` owns this slot's fetching through its own QueryAdapter, so the
    // model adapter here is never called. It throws so a stray
    // `store.find("planbooks_for_user", id)` fails loudly instead of silently
    // returning the wrong shape — every declared type still needs a `models` entry.
    planbooks_for_user: {
      adapter: {
        find: () => Promise.reject(new Error("planbooks_for_user is driven by createQuery")),
      },
    },
    // `planbook` has a real adapter so `useDocument("planbook", id)` works too.
    planbook: {
      adapter: {
        find: (ids) =>
          Promise.all(ids.map((id) => fetch(`/api/planbooks/${id}`).then((r) => r.json()))),
      },
    },
  },
});

// The adapter pages the resource. Return a Promise (a rejection becomes an
// AdapterError) or an Effect to own the failure channel. `signal` aborts when the
// run is interrupted — a timeout fires, a retry abandons the prior attempt, or the
// query is destroyed / superseded.
const adapter: QueryAdapter<PlanbookRef> = {
  fetch: (userId, { offset, limit, signal }) =>
    fetch(`/api/users/${userId}/planbooks?offset=${offset}&limit=${limit}`, { signal }).then((r) =>
      r.json(),
    ),
};

const query = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });

await query.refetch(); // fetch page 0
query.results; // PlanbookRef[] — reactive, lives in the store
query.nextOffset; // number | null

if (query.nextOffset !== null) await query.fetchNextPage(); // merge the next page

query.destroy(); // interrupt any in-flight fetch and unsubscribe
```

The adapter resolves a fixed **response envelope**:

```ts
interface QueryEnvelope<T> {
  data: { results: Array<T> }; // this page's items; each carries its own `offset`
  meta?: { nextOffset?: number | null }; // cursor for the next page, null when exhausted
  included?: Array<{ type: string; id: string }>; // sideloaded docs (JSON-API style)
}
```

Each `included` item must carry its own `type` and `id`; the query inserts it into the store under that type via `insertDocument`, so a sibling `useDocument("planbook", id)` reads the same normalized object — no extra fetch.

### In React

`createQuery` is framework-agnostic, but its fields are reactive, so read them inside a `tracked()` component and they drive fine-grained re-renders. Create the query once and destroy it on unmount:

```tsx
import { useEffect, useMemo } from "react";
import { tracked } from "@supergrain/kernel/react";
import { createQuery } from "@supergrain/queries";
import { useDocumentStore } from "./store"; // from createDocumentStoreContext

const PlanbookList = tracked(({ userId }: { userId: string }) => {
  const store = useDocumentStore();
  const query = useMemo(
    () => createQuery({ store, adapter, type: "planbooks_for_user", id: userId }),
    [store, userId],
  );

  useEffect(() => {
    void query.refetch();
    return () => query.destroy();
  }, [query]);

  return (
    <>
      <ul>
        {query.results.map((r) => (
          <li key={r.id}>{r.id}</li>
        ))}
      </ul>
      {query.nextOffset !== null && (
        <button disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
          {query.isFetching ? "Loading…" : "Load more"}
        </button>
      )}
    </>
  );
});
```

For automatic lifecycle ownership (abort on rerun, dispose on unmount), the same pattern composes with [`@supergrain/husk`](../husk/README.md)'s `useResource` / `defineResource`.

### Pagination semantics

Matches the Ember `live-query` helper:

- **`refetch()`** fetches from offset 0 and replaces the results array wholesale, preserving the server's response order.
- **`fetchNextPage()`** fetches from the stored `nextOffset` (or 0 if none yet) and **sparse-merges** by each result's server `offset` (`results[result.offset] = result`) on top of the existing array.
- An **empty** response at any offset resets the results array to `[]`.

### Resilience — inherited from the store

A query fetch goes through `store.runAdapter`, the same boundary a document `find` uses. With no per-query overrides it inherits the store's resolved defaults (the built-in jittered-fibonacci `defaultRetry` bounded by the 2-minute `defaultDeadline`). Override per query — the same knobs as `ModelConfig`:

```ts
import { Duration, Schedule } from "effect";

createQuery({
  store,
  adapter,
  type: "planbooks_for_user",
  id: "u1",
  limit: 50, // page size (default 200)
  retry: Schedule.recurs(3), // or Schedule.recurs(0) to disable
  timeout: Duration.seconds(10), // bounds a single attempt
  deadline: Duration.seconds(30), // bounds all attempts together (incl. backoff)
});
```

Every failed attempt (and a terminal failure) reports to the store's `onError` sink, and the fetch counts against the store's `maxConcurrency` — exactly like a document fetch. `Query.error` is the same typed `SiloError` channel as a silo handle: a rejected `Promise` adapter surfaces as an `AdapterError` (original rejection on `.cause`); a malformed envelope or a frozen-doc insert surfaces as a `ProcessorError`.

### Live subscription

Pass a `subscribe` hook — typically wrapping your socket transport. It's called once on init with `(type, id, onInvalidate)` and must return an unsubscribe function (invoked by `destroy()`). Call `onInvalidate` whenever the server signals the results are stale; the query refetches from offset 0.

```ts
createQuery({
  store,
  adapter,
  type: "planbooks_for_user",
  id: "u1",
  subscribe: (type, id, onInvalidate) => {
    const channel = socket.subscribe(`${type}:${id}`, () => onInvalidate());
    return () => channel.unsubscribe();
  },
});
```

### Single-flight

A new `refetch()` (or `destroy()`) interrupts any in-flight fetch — its adapter `signal` aborts — so overlapping requests can't race to write the store. `fetchNextPage()` instead waits for an in-flight fetch (superseding it would silently drop a fresher page 0 and merge the next page onto stale results), then reads `nextOffset` from what actually landed. A superseded run's returned promise follows its replacement, so `await refetch()` always reflects the state the query settled into.

## API

### `createQuery(params): Query<T>`

`params` (`CreateQueryParams`):

| Field                                          | Type                                     | Notes                                                                       |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `store`                                        | `DocumentStore<M>`                       | Store to read results from and write pages into.                            |
| `adapter`                                      | `QueryAdapter<T>`                        | Pages the resource. Promise- or Effect-returning.                           |
| `type`                                         | `keyof M & string`                       | The query slot type (a key of the store's `DocumentTypes`).                 |
| `id`                                           | `string`                                 | The slot id — the query's parameter (e.g. a user id).                       |
| `limit?`                                       | `number`                                 | Page size. Default `200`.                                                   |
| `retry` / `timeout` / `deadline` / `retryable` | (same as `ModelConfig`)                  | Per-fetch resilience overrides; resolved per-query → store-wide → built-in. |
| `subscribe?`                                   | `(type, id, onInvalidate) => () => void` | Opt-in live-invalidation hook; return its unsubscribe.                      |

### `Query<T>`

The reactive handle returned by `createQuery`:

- `results: Array<T>` — accumulated page items (reactive; read from the store).
- `nextOffset: number | null` — cursor for the next page, `null` when exhausted.
- `isFetching: boolean` — a fetch is in flight.
- `error: SiloError | undefined` — the last settled fetch's typed failure. Like a silo handle, a previous error stays visible while a refetch is in flight; it clears (or is replaced) when the fetch settles.
- `failureCount: number` — failed attempts in the current fetch cycle, reset to 0 on success.
- `lastError: SiloError | undefined` — the latest attempt's error while retrying.
- `fetchNextPage(): Promise<void>` — fetch + merge the next page using the stored `nextOffset` (or 0).
- `refetch(): Promise<void>` — refetch from offset 0, replacing the results array.
- `destroy(): void` — interrupt any in-flight fetch (aborting its adapter `signal`) and unsubscribe.

### Types

- `QueryAdapter<T>` — `{ fetch(id, { offset, limit, signal? }): Promise<QueryEnvelope<T>> | Effect<QueryEnvelope<T>, AdapterError> }`.
- `QueryEnvelope<T>` — the fixed response shape (`data.results`, optional `meta.nextOffset`, optional `included`).
- `QueryModel<K, T>` — `{ id: string; type: K; results: Array<T>; nextOffset: number | null }` — the value stored under `(type, id)`. Declare it in your `DocumentTypes`.
- `CreateQueryParams<M, K, T>` — the params object above.

## Relationship to silo

`@supergrain/silo` already has params-keyed queries (`useQuery` / `findQuery`) for one-shot, whole-response results. Reach for `@supergrain/queries` when the result is a **growing, paginated** list that you also want to **live-refresh** — it layers those two behaviors on top of the same store, sharing silo's fetch engine, error channel, and telemetry rather than re-implementing them.

## License

MIT
