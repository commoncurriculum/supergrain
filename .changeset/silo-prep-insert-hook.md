---
"@supergrain/silo": minor
---

Add a store-wide `hooks` config (parallel to `models` / `queries`) with its first hook, `prepInsert`.

`prepInsert(doc, type)` is a doc-in / doc-out normalization hook run on **every** `insertDocument(type, doc)` — a direct `store.insertDocument(...)`, a processor insert (including JSON-API `included` sideloads), a Provider `initial` seed, or any future code path. It's the one funnel every document passes through on its way into the cache, so a shape migration or a defaulted field lives in exactly one place instead of every insertion site.

Normalize **in place** (mutate `doc`) and/or **return a replacement** — the returned doc is what gets stored; returning nothing keeps the (possibly mutated) `doc`, mirroring a processor's `?? response` pass-through. It runs before the doc is wrapped in the reactive proxy, so in-place edits notify no subscribers. When models share a literal `type` discriminant, branch on `doc.type` to narrow; otherwise branch on the `type` argument. `prepInsert` covers documents only — query results (`insertQueryResult`) are not run through it.

```ts
createDocumentStore<TypeToModel>({
  hooks: {
    prepInsert(doc) {
      if (doc.type === "card-stack") migrateFromCardsInPlace(doc);
      doc.meta ??= {};
      return doc;
    },
  },
  models: {
    "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
  },
});
```
