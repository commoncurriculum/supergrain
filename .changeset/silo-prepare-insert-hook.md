---
"@supergrain/silo": minor
---

Add a store-wide `hooks` config (parallel to `models` / `queries`) with two hooks that bracket **every** `insertDocument(type, doc)` — a direct `store.insertDocument(...)`, a processor insert (including JSON-API `included` sideloads), a Provider `initial` seed, or any future code path. Cross-cutting insert behavior now lives in one place instead of every insertion site. Both share the **same `(type, doc)` signature as `insertDocument`**, forming the pipeline `prepareInsert → insertDocument → afterInsert`.

- **`prepareInsert(type, doc)`** — a normalization hook that runs on the way _in_. `type` is an input (the hook needs it to do per-type work, since a silo doc needn't carry its own type) but it returns only the doc to insert — the caller already knows the type. Normalize **in place** (mutate `doc`) and return it, or return a wholesale replacement. Returning `null` or `undefined` vetoes the insert (the two are treated identically; a hook that doesn't return a doc writes nothing). It runs before the doc is wrapped in the reactive proxy, so in-place edits notify no subscribers.
- **`afterInsert(type, doc)`** — a side-effect observer that runs on the way _out_, once the write is committed (cache settled, subscribers notified). It receives the type and the doc that was actually written; its return value is ignored — use it to mirror the document into another store, update a derived index, or emit telemetry. It does not run when `prepareInsert` vetoes the insert.

When models share a literal `type` discriminant, branch on `doc.type` to narrow; otherwise branch on the `type` argument. Both hooks cover documents only — query results (`insertQueryResult`) are not run through them.

```ts
createDocumentStore<TypeToModel>({
  hooks: {
    prepareInsert(type, doc) {
      if (doc.archived) return null; // drop — never cache archived docs
      if (doc.type === "card-stack") migrateFromCardsInPlace(doc);
      doc.meta ??= {};
      return doc;
    },
    afterInsert: (type, doc) => emberStore.insertDocument(doc),
  },
  models: {
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
});
```
