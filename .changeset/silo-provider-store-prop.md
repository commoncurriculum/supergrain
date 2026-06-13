---
"@supergrain/silo": minor
---

feat(silo/react): `createDocumentStoreContext` Provider can adopt a pre-built store

The Provider now accepts a `store` prop as an alternative to `config`: pass a `DocumentStore` instance you constructed yourself (via `createDocumentStore`) and the Provider binds it to context as-is instead of constructing one. This is for the cases `config` can't serve — sharing one store instance across multiple React roots, or driving it from non-React code. (`config` paired with `initial`/`onMount` still covers SSR data transfer and in-tree imperative setup.)

`config` and `store` are the two ends of one pipeline (a recipe vs. the store built from it), so they're mutually exclusive: provide exactly one. Supplying neither — or both — throws. `config` is now optional, which is a backward-compatible change (existing `config`-only usage is unaffected).
