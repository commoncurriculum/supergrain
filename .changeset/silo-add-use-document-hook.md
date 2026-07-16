---
"@supergrain/silo": minor
---

Add useDocuments React hook and store.findAll method. findAll returns a stable
DocumentsHandle per (type, ids). Its `values` is a live kernel reactive array
reconciled in place as handles settle — so reads are fine-grained (a reader of
one slot re-renders only when that slot changes) with a never-churning array
identity — and its scalar/promise aggregates (status, statusStrict, promise,
promiseStrict) are kernel computeds, re-firing subscribers only when the
aggregate value itself changes.
