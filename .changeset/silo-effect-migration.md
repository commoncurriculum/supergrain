---
"@supergrain/silo": major
---

Rebuild the network/async layer on an internal [Effect](https://effect.website/) engine and remodel the reactive handle as a statechart. **Breaking.**

**Adapters stay Promise-first.** `DocumentAdapter.find` returns `Promise<unknown> | Effect.Effect<unknown, AdapterError>` — **return a plain `Promise`** for the common case (the store runs it on its Effect engine and turns a rejection into an `AdapterError` for you), or **return an `Effect`** to own the failure channel / compose retries / manage resources. Effect powers the engine internally but is not required at the adapter boundary. `effect` is a peer dependency (installed, but you don't have to write Effect).

**Typed errors.** New `AdapterError` / `NotFoundError` / `ProcessorError` (`Data.TaggedError`, union `SiloError`), exported from the root. They are the `E` channel of adapter Effects and the error carried by a failed handle.

**Per-model `retry` / `timeout`.** `ModelConfig` and `QueryConfig` accept an Effect `Schedule` (`retry`) and a `Duration` (`timeout`).

**Fiber-based cancellation on unsubscribe.** Each chunk's fetch runs on its own interruptible fiber, and the batch window now runs on `Effect.sleep` (the whole engine is on Effect's clock). The store ref-counts subscribers per key: `subscribeDocument(type, id)` / `subscribeQuery(type, params)` return an unsubscribe function, and the React `useDocument` / `useQuery` hooks call them on mount/unmount. When the last subscriber for **every** key in an in-flight chunk goes away, the fetch is interrupted — aborting the request via an `AbortSignal` — and its handles reset to idle so renewed interest refetches. Adapters receive that signal: `find(ids, { signal })` (optional) — thread it into `fetch(url, { signal })` for a real network abort, or ignore it and interruption just discards the result (no stale write). A new `gcTimeMs` config (default `0` = next tick) defers the interrupt so a synchronous re-subscribe (StrictMode remount, fast nav-back) cancels it; raise it for TanStack-style "keep the fetch warm" behavior.

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

Migration: replace `handle.data` with `handle.value`; `handle.isPending` with `handle.value === undefined && handle.isFetching`; `handle.hasData` with `handle.value !== undefined`; `handle.status` string literals are now lowercase. Promise-returning adapters keep working as-is — no `Effect.tryPromise` wrapping required.
