---
"@supergrain/silo": major
---

Migrate the network/async layer to [Effect](https://effect.website/) and remodel the reactive handle as a statechart. **Breaking.**

**Adapters now return `Effect` instead of `Promise`.** `DocumentAdapter.find` / `QueryAdapter.find` return `Effect.Effect<unknown, AdapterError>` — typically `Effect.tryPromise({ try, catch: (cause) => new AdapterError(...) })`. `effect` is now a (required) peer dependency.

**Typed errors.** New `AdapterError` / `NotFoundError` / `ProcessorError` (`Data.TaggedError`, union `SiloError`), exported from the root. They are the `E` channel of adapter Effects and the error carried by a failed handle.

**Per-model `retry` / `timeout`.** `ModelConfig` and `QueryConfig` accept an Effect `Schedule` (`retry`) and a `Duration` (`timeout`).

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

Migration: replace `handle.data` with `handle.value`; `handle.isPending` with `handle.value === undefined && handle.isFetching`; `handle.hasData` with `handle.value !== undefined`; `handle.status` string literals are now lowercase; and wrap Promise-returning adapters in `Effect.tryPromise`.
