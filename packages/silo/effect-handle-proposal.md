# silo + Effect — handle design

How we get **type safety (illegal states unrepresentable + exhaustive
matching)** *and* **per-field reactivity** at the same time, while moving silo's
network/async layer onto Effect. Breaking is acceptable (library isn't widely
adopted), so this assumes we go all the way.

---

## The core idea: runtime representation ≠ type

Two independent things were conflated in the first draft of this doc:

- **Per-field reactivity** comes from the *runtime representation*: a single
  **stable reactive proxy** whose individual fields are mutated **in place**.
  Reading `handle.data` subscribes to the `data` cell only.
- **Type safety** comes from the *type*, not the runtime shape.

An earlier option made the public handle an **immutable `Data.TaggedEnum`
value**. That's what forced whole-object replacement on every transition and
collapsed per-field tracking into per-handle tracking. We simply don't do that.

Instead: **keep today's runtime exactly as-is** (one stable proxy, in-place
mutation, `status` is just another tracked field) and **type it as a
discriminated union** keyed on `status`.

---

## 1. The public handle — discriminated union over a stable proxy

```ts
import type { AdapterError } from "./errors";

export interface IdleHandle {
  readonly status: "IDLE";
}
export interface PendingHandle<T> {
  readonly status: "PENDING";
  readonly promise: Promise<T>;
}
export interface SuccessHandle<T> {
  readonly status: "SUCCESS";
  readonly data: T;
  readonly fetchedAt: Date;
  /** stale-while-revalidate: a refetch is in flight but we still have data */
  readonly refreshing: boolean;
  readonly promise: Promise<T>;
}
export interface FailureHandle<T, E = AdapterError> {
  readonly status: "ERROR";
  readonly error: E;
  readonly promise: Promise<T>;
}

export type DocumentHandle<T, E = AdapterError> =
  | IdleHandle
  | PendingHandle<T>
  | SuccessHandle<T>
  | FailureHandle<T, E>;
```

`QueryHandle<T, E>` is the same shape.

The runtime object still physically carries every field (`data`, `error`,
`resolve`, `reject`, …) — the **type** just hides the ones that don't belong to
the current state. `store.find` / `useDocument` return the *same stable proxy*
they do today; only the cast at the boundary changes from a flat interface to
this union.

---

## 2. Type safety — illegal states unrepresentable

```tsx
const user = useDocument("user", id);

switch (user.status) {
  case "IDLE":    return null;
  case "PENDING": return <Spinner />;
  case "ERROR":   return <ErrorBanner message={user.error.message} />;
  //                                          ^ user.data here → compile error
  case "SUCCESS": return <h3>{user.data.attributes.firstName}</h3>;
  //                          ^ data: T (never `T | undefined`)
}
// no `default` → TypeScript exhaustiveness: add a 5th state and this won't compile
```

Optional ergonomic matcher (reactivity-preserving — see §3):

```ts
export function matchHandle<T, E, R>(
  h: DocumentHandle<T, E>,
  arms: {
    IDLE: () => R;
    PENDING: (h: PendingHandle<T>) => R;
    SUCCESS: (h: SuccessHandle<T>) => R;
    ERROR: (h: FailureHandle<T, E>) => R;
  },
): R {
  switch (h.status) {            // reads `status` only
    case "IDLE":    return arms.IDLE();
    case "PENDING": return arms.PENDING(h);
    case "SUCCESS": return arms.SUCCESS(h); // branch reads h.data lazily
    case "ERROR":   return arms.ERROR(h);
  }
}
```

```tsx
matchHandle(user, {
  IDLE:    () => null,
  PENDING: () => <Spinner />,
  SUCCESS: ({ data, refreshing }) => <Card busy={refreshing} name={data.attributes.firstName} />,
  ERROR:   ({ error }) => <ErrorBanner message={error.message} />,
});
```

---

## 3. Per-field reactivity — identical to today

The runtime is the same stable proxy with in-place field mutation, so the
kernel's per-field tracking is unchanged:

- The `SUCCESS` arm above reads `status` and `data`. When `fetchedAt` or
  `refreshing` mutates, neither is read → **no re-render**.
- `refetch` of a loaded doc keeps `status: "SUCCESS"` and only flips
  `refreshing` / swaps `data` in place. A list of components reading `data`
  re-renders only when *their* `data` actually changes — same fine-grained
  behavior as today.
- Reading `status` to narrow subscribes you to genuine state transitions
  (IDLE→PENDING→SUCCESS/ERROR) — which is the correct dependency for code that
  branches on state, and is exactly what you'd want to re-render on.

No whole-object replacement, so no "re-render on every field change" storm.

---

## 4. Suspense

```ts
import { use } from "react";

export function useSuspend<T>(h: DocumentHandle<T>): T {
  switch (h.status) {
    case "IDLE":    throw new Promise<never>(() => {}); // idle = no id; suspend
    case "PENDING": return use(h.promise);
    case "ERROR":   throw h.error;
    case "SUCCESS": return h.data;
  }
}
```

```tsx
const user = useSuspend(useDocument("user", id)); // suspends on first load only
```

Batching still collapses sibling `useSuspend` calls into one
`adapter.find([...])` before suspending — same non-waterfalling behavior as
today.

---

## 5. Where Effect's statecharts live (internal)

The `Data.TaggedEnum` / `$match` style goes **inside the finder**, as the pure
transition reducer — exhaustive over every event × state — and we *project* the
result onto the proxy by mutating fields:

```ts
import { Data, Match } from "effect";

type HandleEvent<T> = Data.TaggedEnum<{
  Fetch:   {};
  Resolve: { data: T };
  Reject:  { error: AdapterError };
  Insert:  { data: T };            // out-of-band insertDocument
}>;

// pure, exhaustive: decide the field patch for (currentStatus, event)
// then apply inside the existing `batch(() => { ...mutate proxy... })`.
```

So the transition logic is statechart-rigorous and Effect-flavored, the public
handle narrows fully, and reactivity is untouched.

---

## 6. The rest of the Effect migration (unchanged by the above)

- `src/errors.ts` — `AdapterError` / `NotFoundError` / `ProcessorError`
  (`Data.TaggedError`).
- Adapter contracts return `Effect.Effect<unknown, AdapterError, R>` instead of
  `Promise<unknown>`; optional per-model `retry` (`Schedule`) / `timeout`; `R`
  provided via `config.layer` and erased after `Effect.provide`.
- `finder.ts` rewritten on Effect — `Effect.forEach({ concurrency })` for chunk
  fan-out, typed `catchAll`, per-store `ManagedRuntime`, `store.dispose()`.
- Determinism phased: keep `setTimeout` batch window first; optional Phase 2
  swaps to `Effect.sleep` + `TestClock`.
- `effect@^3.21` as a **peer dependency**; update `tests/example-app.ts`
  adapters + suites, silo + root README examples (`test:validate`), major
  Changeset (4.0.0 → 5.0.0).

---

## 7. Outcome

| | Old flat handle | Immutable `TaggedEnum` value | **This design** |
|---|---|---|---|
| Read `data` while pending | `undefined` at runtime | compile error | **compile error** |
| Exhaustive states | manual | `$match` | **`switch`/`matchHandle`, TS-checked** |
| Reactivity granularity | per-field | per-handle | **per-field** |
| Runtime change | — | replace value each transition | **none (same proxy, in-place mutation)** |

Type safety + exhaustiveness + per-field reactivity — no compromise.
