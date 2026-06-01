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

## 1. The public handle — two orthogonal regions, not one enum

A single flat enum (`IDLE|PENDING|SUCCESS|ERROR`) models async state as **one
axis**, which is a leaky abstraction: it can't represent "I have stale data
*and* a background refetch is in flight," or "I have stale data *and* the latest
refetch errored." Forcing this-or-that throws information away, and it tempts
you to call a refetch "pending" (it isn't — pending means *no data yet*).

The lifecycle is actually **two orthogonal regions** (Harel parallel states):

- **Region A — data availability:** `Absent | Present(value, fetchedAt)`
- **Region B — fetch activity:** `Idle | Fetching | Failed(error)`

All six combinations are meaningful:

| | Idle | Fetching | Failed |
|---|---|---|---|
| **Absent**  | never fetched | first load | first load failed |
| **Present** | settled | background refetch | **stale data + refetch error** |

```ts
import type { AdapterError } from "./errors";

export type DataState<T> =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Present"; readonly value: T; readonly fetchedAt: Date };

export type FetchState<E = AdapterError> =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Fetching" }
  | { readonly _tag: "Failed"; readonly error: E };

export interface DocumentHandle<T, E = AdapterError> {
  readonly data: DataState<T>;
  readonly fetch: FetchState<E>;
  /** stable promise for React `use()`; present once a fetch has started */
  readonly promise: Promise<T> | undefined;
}
```

`QueryHandle<T, E>` is the same shape.

`value` exists only when `data._tag === "Present"`; `error` only when
`fetch._tag === "Failed"` — illegal states unrepresentable, both regions
exhaustively narrowable — but the two axes vary **independently**, so stale
`value` and a refetch `error` coexist instead of clobbering each other.

The runtime is two stable reactive cells (`data`, `fetch`) on the existing
proxy, mutated in place. `store.find` / `useDocument` return the same proxy;
only its type changes.

---

## 2. Type safety + the ergonomic matcher

Reading a region narrows it; the two regions are independent:

```tsx
const u = useDocument("user", id);

// show stale data AND the refetch error together — the flat enum couldn't:
if (u.data._tag === "Present") {
  return <Card user={u.data.value}                         // value: T
               busy={u.fetch._tag === "Fetching"}
               warn={u.fetch._tag === "Failed" ? u.fetch.error : undefined} />;
}
```

Most call sites don't care about background state. `matchHandle` collapses the
product into the four cases people branch on, folding the background info into
`Ready`:

```ts
export function matchHandle<T, E, R>(
  h: DocumentHandle<T, E>,
  arms: {
    Idle:       () => R;                                              // Absent × Idle
    Loading:    () => R;                                              // Absent × Fetching
    LoadFailed: (a: { error: E }) => R;                               // Absent × Failed
    Ready:      (a: { value: T; fetchedAt: Date;
                      refetching: boolean; refetchError: E | undefined }) => R; // Present × *
  },
): R;
```

```tsx
matchHandle(u, {
  Idle:       () => null,
  Loading:    () => <Spinner />,                       // never fires on a refetch
  LoadFailed: ({ error }) => <ErrorPage e={error} />,
  Ready:      ({ value, refetching, refetchError }) =>
                <Card user={value} busy={refetching} warn={refetchError} />,
});
```

`Loading` / `LoadFailed` only fire with no data; a refetch surfaces as
`Ready.refetching`, a refetch error as `Ready.refetchError` **alongside**
`value`. The raw `data` / `fetch` regions stay available for full control.

---

## 3. Per-field reactivity — identical to today

Two independent reactive cells, mutated in place, so the kernel's per-field
tracking is unchanged:

- A component reading `u.data` does **not** re-render when `u.fetch` toggles
  Idle↔Fetching — so a background refetch over a loaded doc re-renders nothing
  until the new `value` actually lands.
- A component watching a spinner reads `u.fetch` and re-renders on activity
  changes — the correct dependency.
- No whole-object replacement, so no "re-render on every field change" storm.

This is the parallel-statechart model: two regions, each its own cell, each
tracked independently.

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
import { Data } from "effect";

type HandleEvent<T> = Data.TaggedEnum<{
  Fetch:   {};                     // a (re)fetch started
  Resolve: { value: T };           // fetch settled with data
  Reject:  { error: AdapterError };// fetch settled with an error
  Insert:  { value: T };           // out-of-band insertDocument
}>;

// pure, exhaustive reducer over (DataState, FetchState, event) → next regions,
// e.g. Reject while data is Present → keep data Present, set fetch Failed
// (stale data + refetch error). Applied inside the existing
// `batch(() => { ...mutate the two cells... })`.
```

So the transition logic is statechart-rigorous and Effect-flavored, the public
handle narrows fully per region, and reactivity is untouched.

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

| | Old flat handle | Single discriminated enum | **Two orthogonal regions** |
|---|---|---|---|
| Read `value` before load | `undefined` at runtime | compile error | **compile error** |
| Stale data + background refetch | — | can't express (or mislabels "pending") | **`data: Present` + `fetch: Fetching`** |
| Stale data + refetch error | — | must drop one | **`data: Present` + `fetch: Failed` (both)** |
| Exhaustive states | manual | TS-checked | **TS-checked per region + `matchHandle`** |
| Reactivity granularity | per-field | per-handle (if immutable value) | **per-region cell, in-place mutation** |

Type safety + exhaustiveness + per-field reactivity + honest refetch
semantics — no compromise.
