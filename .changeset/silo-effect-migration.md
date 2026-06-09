---
"@supergrain/silo": major
---

Rebuild the network/async layer on an internal [Effect](https://effect.website/) engine and remodel the reactive handle as a statechart. **Breaking.**

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
