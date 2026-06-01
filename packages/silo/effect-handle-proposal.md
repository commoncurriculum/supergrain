# silo + Effect — tagged-union handle prototype

A concrete look at what `DocumentHandle` / `QueryHandle` become if we make them
public `Data.TaggedEnum`s. Nothing here is wired up yet — it's a design sketch
so you can decide if you like the *look* before we commit. Breaking is fine
(library isn't widely adopted), so this assumes we go all the way.

---

## 1. The handle type

`Data.TaggedEnum` needs the `WithGenerics` dance to stay generic over the doc
type `T` and the error type `E`:

```ts
import { Data } from "effect";
import type { AdapterError } from "./errors";

export type DocumentHandle<T, E = AdapterError> = Data.TaggedEnum<{
  Idle:    {};
  Pending: { readonly promise: Promise<T> };
  Success: {
    readonly data: T;
    readonly fetchedAt: Date;
    /** stale-while-revalidate: a refetch is in flight but we still have data */
    readonly refreshing: boolean;
    readonly promise: Promise<T>;
  };
  Failure: {
    readonly error: E;
    readonly promise: Promise<T>;
  };
}>;

interface DocumentHandleDef extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: DocumentHandle<this["A"], this["B"]>;
}

export const DocumentHandle = Data.taggedEnum<DocumentHandleDef>();
// → DocumentHandle.Idle / .Pending / .Success / .Failure constructors
// → DocumentHandle.$is("Success") / DocumentHandle.$match(...)
```

`QueryHandle<T, E>` is the identical shape (alias kept for call-site clarity).

What this buys: **`data` exists only on `Success`, `error` only on `Failure`.**
You cannot read `handle.data` while pending — it's a compile error, not
`undefined`.

---

## 2. Store / hook signatures

```ts
interface DocumentStore<M, Q> {
  find<K extends keyof M>(type: K, id: string | null): DocumentHandle<M[K]>;
  // ...
}

// hooks
function useDocument<K>(type: K, id: string | null): DocumentHandle<M[K]>;
function useQuery<K>(type: K, params: Q[K]["params"] | null): QueryHandle<Q[K]["result"]>;
```

`null`/`undefined` id → `DocumentHandle.Idle()`.

---

## 3. What consumer code looks like

### (a) The common case — exhaustive `$match`

```tsx
import { DocumentHandle } from "@supergrain/silo";

function UserCard({ id }: { id: string }) {
  const user = useDocument("user", id);

  return DocumentHandle.$match(user, {
    Idle:    () => null,
    Pending: () => <Spinner />,
    Success: ({ data, refreshing }) => (
      <article aria-busy={refreshing}>
        <h3>{data.attributes.firstName}</h3>
      </article>
    ),
    Failure: ({ error }) => <ErrorBanner message={error.message} />,
  });
}
```

If you add a fifth state later, every `$match` without that arm fails to
compile. That's the statechart guarantee.

### (b) Quick reads — tag narrowing

```tsx
function UserName({ id }: { id: string }) {
  const user = useDocument("user", id);
  if (user._tag !== "Success") return <Skeleton />;
  return <>{user.data.attributes.firstName}</>;
  //          ^ data only in scope because we narrowed to Success
}
```

### (c) Suspense — a tiny helper carries the promise

`use()` needs the in-flight promise during `Pending`, and the error thrown
during `Failure`. One helper hides the plumbing:

```ts
import { use } from "react";

/** Suspends on Pending, throws on Failure, returns data on Success. */
export function useSuspend<T>(handle: DocumentHandle<T>): T {
  switch (handle._tag) {
    case "Idle":    throw new Promise<never>(() => {}); // suspends forever; idle = no id
    case "Pending": return use(handle.promise);
    case "Failure": throw handle.error;
    case "Success": return handle.data;
  }
}
```

```tsx
function Profile({ id }: { id: string }) {
  const user = useSuspend(useDocument("user", id)); // suspends on first load
  return <h1>{user.attributes.firstName}</h1>;       // never re-suspends on refetch
}
```

Batching still collapses sibling `useSuspend` calls into one
`userAdapter.find([...])` before suspending — same non-waterfalling behavior as
today.

### (d) Lists

```tsx
function UserList({ ids }: { ids: string[] }) {
  return ids.map((id) => <UserCard key={id} id={id} />);
  // each UserCard $matches its own handle; one batched fetch underneath
}
```

---

## 4. How the store produces it (internal)

`find` seeds `Idle`, transitions to `Pending`, and the finder replaces the
reactive cell with `Success`/`Failure` when the adapter Effect settles:

```ts
// transition is a whole-value replacement, not field mutation
cell.handle = DocumentHandle.Pending({ promise });
// ...later, in the finder, inside batch():
cell.handle = DocumentHandle.Success({ data, fetchedAt: new Date(), refreshing: false, promise });
```

Refetch of an already-loaded doc:

```ts
cell.handle = DocumentHandle.Success({ ...prev, refreshing: true }); // keep data, mark busy
// on settle → refreshing: false with fresh data; on error → could stay Success or go Failure
```

The Effect finder builds these transitions exhaustively; an internal
`$match`-driven reducer makes every edge explicit.

---

## 5. The one real tradeoff (honest)

Today's flat handle gets **per-field** reactivity from the kernel: a component
that reads only `handle.data` does *not* re-render when `fetchedAt` changes. A
tagged union is an **immutable value** — every transition replaces the whole
handle object, so subscribers re-run on any transition (Pending→Success,
Success→refreshing, etc.).

In practice this is fine for a load lifecycle (the state genuinely changed, and
`refreshing`/`data` are usually what people read). But it does collapse
fine-grained per-property tracking down to per-handle tracking. If we keep the
flat shape instead, we preserve per-field reactivity and the internal statechart
still gives us exhaustive transitions — just not at the consumer's call site.

---

## 6. Side-by-side

| | Flat (today's shape) | Tagged-union (this proposal) |
|---|---|---|
| Read `data` while pending | `undefined` at runtime | compile error |
| Exhaustive UI states | manual `if` ladder | `$match` enforced by types |
| Suspense | `use(handle.promise!)` | `useSuspend(handle)` helper |
| Reactivity granularity | per-field | per-handle |
| Consumer migration | none | rewrite every read site |
| "Looks like" | React Query-ish | Effect/statechart-ish |

---

## 7. Recommendation

Both are viable now that breaking is acceptable. The tagged-union is the more
"statechart" design and reads well with `$match`; its only genuine cost is the
per-field→per-handle reactivity change (section 5) and rewriting read sites.

If that reactivity granularity matters for big lists, we keep the flat public
shape and put the `Data.TaggedEnum` statechart *inside* finder/store only.
