---
"@supergrain/silo": minor
---

Add multi-document reads in two shapes:

- `store.findAllIndividually(type, ids)` / `useDocumentsIndividually(type, ids)`
  return one **independent** `DocumentHandle` per id (in id order); each settles
  on its own, so you can render each document as it arrives.
- `store.findAllTogether(type, ids)` / `useDocumentsTogether(type, ids)` return a
  single **all-or-nothing** `DocumentsTogetherHandle`: `pending` until every
  document has loaded, `success` with `value` = all documents in id order once
  they have, `error` if any fails (with a combined `promise` for `use()`).

Both batch their fetches through `store.find`, so N ids collapse into one
`adapter.find(ids)` call.
