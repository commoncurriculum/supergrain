---
"@supergrain/silo": major
---

Migrate the network/async layer to [Effect](https://effect.website/) and remodel the reactive handle as a statechart. **Breaking.**

**Adapters now return `Effect` instead of `Promise`.** `DocumentAdapter.find` / `QueryAdapter.find` return `Effect.Effect<unknown, AdapterError>` — typically `Effect.tryPromise({ try, catch: (cause) => new AdapterError(...) })`. `effect` is now a (required) peer dependency.

**Typed errors.** New `AdapterError` / `NotFoundError` / `ProcessorError` (`Data.TaggedError`, union `SiloError`), exported from the root. They are the `E` channel of adapter Effects and the error carried by a failed handle.

**Per-model `retry` / `timeout`.** `ModelConfig` and `QueryConfig` accept an Effect `Schedule` (`retry`) and a `Duration` (`timeout`).

**The handle is now two orthogonal regions instead of flat fields.** `DocumentHandle` / `QueryHandle` expose:

```ts
{
  data:  { _tag: "Absent" } | { _tag: "Present"; value: T; fetchedAt: Date };
  fetch: { _tag: "Idle" } | { _tag: "Fetching" } | { _tag: "Failed"; error: SiloError };
  promise: Promise<T> | undefined;
}
```

The previous flat fields (`status`, `data: T | undefined`, `error`, `isPending`, `isFetching`, `hasData`, `fetchedAt`) and the `Status` type are removed. The two regions vary independently, so a stale `value` and a refetch error coexist (stale-while-revalidate); `value`/`error` are type-narrowed to the states where they exist; and reads subscribe per region, preserving fine-grained reactivity.

Migration: replace `handle.data` with `handle.data._tag === "Present" ? handle.data.value : undefined`, `handle.isPending` with `handle.data._tag === "Absent" && handle.fetch._tag === "Fetching"`, `handle.error` with `handle.fetch._tag === "Failed" ? handle.fetch.error : undefined`, and wrap Promise-returning adapters in `Effect.tryPromise`.
