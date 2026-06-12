---
"@supergrain/silo": minor
---

Add a store-wide `hooks` config (parallel to `models` / `queries`) with two hooks that bracket **every** `insertDocument(type, doc)` — a direct `store.insertDocument(...)`, a processor insert (including JSON-API `included` sideloads), a Provider `initial` seed, or any future code path. Cross-cutting insert behavior now lives in one place instead of every insertion site.

- **`prepareInsert(doc, type)`** — a doc-in / doc-out normalization hook that runs on the way _in_. Normalize **in place** (mutate `doc`) and/or **return a replacement** — the returned doc is what gets stored. Returning nothing (or `undefined`) keeps the (possibly mutated) `doc`, mirroring a processor's `?? response` pass-through; returning `null` vetoes the insert (the document is dropped and nothing is written). It runs before the doc is wrapped in the reactive proxy, so in-place edits notify no subscribers.
- **`afterInsert(doc, type)`** — a side-effect observer that runs on the way _out_, once the write is committed (cache settled, subscribers notified). It receives the exact stored object and its return value is ignored — use it to mirror the document into another store, update a derived index, or emit telemetry. It does not run when `prepareInsert` vetoes the insert.

When models share a literal `type` discriminant, branch on `doc.type` to narrow; otherwise branch on the `type` argument. Both hooks cover documents only — query results (`insertQueryResult`) are not run through them.

```ts
createDocumentStore<TypeToModel>({
  hooks: {
    prepareInsert(doc) {
      if (doc.archived) return null; // drop — never cache archived docs
      if (doc.type === "card-stack") migrateFromCardsInPlace(doc);
      doc.meta ??= {};
      return doc;
    },
    afterInsert: (doc) => emberStore.insertDocument(doc),
  },
  models: {
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
});
```
