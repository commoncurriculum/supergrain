---
"@supergrain/silo": minor
---

Add an ordered response-processor pipeline to both surfaces — `ModelConfig`
(documents) and `QueryConfig` (queries).

A model or query can now declare `processors: [...]` — an ordered pipeline run
in declared order after `adapter.find(...)` resolves. This makes the fetch
lifecycle explicit and lets applications compose response work in execution
order (migrate → mirror into another store → insert into silo) instead of
cramming every responsibility into one processor.

```ts
"card-stack": {
  adapter: cardStackAdapter,
  processors: [
    migrateCardStackResponse(),                 // mutate fetched docs in place
    mirrorResponseDocumentsToEmber(emberStore), // side effect: hydrate another store
    jsonApiProcessor,                           // insert into silo
  ],
}
```

**Ordered pipeline semantics.** Silo passes the adapter response through each
processor in order. A processor may mutate the response, **return a replacement
response** (handed to later processors), perform side effects, or insert
documents. Returning `undefined` — or `null` — passes the current response
through unchanged (pass-through uses `??`, so `null` can't be used to replace
the response). A throw stops the pipeline (the remaining processors don't run)
and fails the chunk with a `ProcessorError` — the same terminal behavior as a
single `processor` throw.

**Backward compatible config.** The single `processor` field still works and is
normalized to a one-element pipeline, so `{ adapter }`,
`{ adapter, processor: defaultProcessor }`, and
`{ adapter, processors: [defaultProcessor] }` are all equivalent. Setting
**both** `processor` and `processors` on the same model is a configuration error
and throws at store creation.

**Processor signatures.** Both processor types now have the shape
`(response, context) => unknown | void`:

- `ResponseProcessor` (documents): `context` is `{ store, type, ids }`
  (previously `(raw, store, type) => void`).
- `QueryProcessor` (queries): `context` is `{ store, type, paramsList }`
  (previously `(raw, store, type, paramsList) => void`).

The bundled `defaultProcessor` / `jsonApiProcessor` / `defaultQueryProcessor`
and every config that uses them are unaffected; hand-written custom processors
that relied on the old positional arguments should read `store` / `type` /
`paramsList` off the context object and can now return a replacement response.
New `ProcessorContext` and `QueryProcessorContext` types are exported for typing
custom processors.
