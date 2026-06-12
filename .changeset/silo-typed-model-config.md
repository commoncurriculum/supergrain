---
"@supergrain/silo": minor
---

Add an inferred model-config typing style to `createDocumentStore`. Colocate each document type with its model config via `type: typeOf<T>()` and Silo infers the `DocumentStore<Documents>` map from the configured models — no separate `Documents` generic to keep in sync. The explicit-generic form (`createDocumentStore<Documents>({ models })`) is unchanged and remains supported; the new `typeOf<T>()` marker is purely additive and has zero runtime behavior.
