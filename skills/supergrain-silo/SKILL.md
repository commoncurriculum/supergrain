---
name: supergrain-silo
description: Load, cache, and paginate server entities with Supergrain's document store (@supergrain/silo, @supergrain/queries) — fetching a record by id, keying a fetch on params, suspending on first load, refreshing, and paginated or live feeds. Use this whenever React code in a project depending on @supergrain/silo or @supergrain/queries needs data from a server keyed by id or params, or a feed that loads more on demand. For component state, derived values, effects, lists, and writes, use the supergrain skill.
---

# Supergrain silo

Server documents, cached and reactive. Assumes the **supergrain** skill's rules: wrap components in `tracked()`, something re-runs when the reactive state it read changes, and mutating in place is how you write.

- `@supergrain/silo` — the `DocumentStore` and `SiloError` types
- `@supergrain/silo/react` — `createDocumentStoreContext` **only**; it returns `Provider` / `useDocumentStore` / `useDocument` / `useQuery`
- `@supergrain/queries` — `createQuery`

## Setup

```tsx
type Models = { book: Book };        // every document needs an `id: string`
type Queries = { shelf: { params: P; result: R } };
// declare both with `type`: an `interface` has no index signature and fails the constraint
const { Provider, useDocumentStore, useDocument, useQuery } =
  createDocumentStoreContext<DocumentStore<Models, Queries>>();
// adapter: `{ find(keys, ctx?) }` over batched keys — ids for a model,
// params objects for a query — resolving the documents as an array
<Provider config={{ models: { book: { adapter } }, queries: { shelf: { adapter } } }}>
```

## Reading

`useDocument("book", id)` and `useQuery("shelf", params)` return a handle. A `null` id or params skips the fetch, which is how you hold off until something is selected.

| Read          | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `.status`     | `"pending"` / `"success"` / `"error"` — the discriminant                       |
| `.value`      | `undefined` until it resolves, then survives later refetches                   |
| `.error`      | a `SiloError`                                                                  |
| `.isFetching` | true while a fetch is in flight, including a refetch over an existing `.value` |
| `.promise`    | `undefined` between fetches                                                    |

A loaded `.value` is a **mutable reactive object**: assign fields on it, or `update()` it in place with mill. It is the stored document, not a snapshot.

Suspense: `use(handle.promise!)`, guarded so it only suspends on first load — `if (handle.value === undefined) use(handle.promise!)`.

## Refreshing

A handle has no `refetch`. It re-reads when the id or params it is keyed on change, so the usual lever is changing those. A document whose id never changes has no such lever: write the new one with `store.insertDocument(type, doc)`, taking the store from `useDocumentStore()`.

## Paginated and live feeds

`createQuery({ store, adapter, type, id })` — a plain function, not a hook. `type` is the model its rows become, `id` this feed's own key.

Its `store` must be typed `DocumentStore<Models>` with **no** query types, so it is the alternative to `useQuery` above rather than a companion. Its adapter is a different shape too: `{ fetch(id, { offset, limit, signal }) }` resolving `{ data: { results }, meta?: { nextOffset } }`, with each result row carrying an `offset`.

It exposes `.results` / `.nextOffset` / `.isFetching` / `.error`, and — alone among the handles here — `refetch()`, alongside `fetchNextPage()` and `destroy()`. It fetches nothing until you call `fetchNextPage()`.

Every behavioural claim above is pinned by `packages/silo/tests/skill-claims/*.test.tsx`.
