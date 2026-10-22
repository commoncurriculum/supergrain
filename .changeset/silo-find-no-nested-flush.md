---
"@supergrain/silo": patch
---

`find` / `findQuery` / `findDocumentsIndividually` / `findDocumentsTogether` no longer flush pending signal effects when they start a fetch. A first-time handle is now created already fetching (with its promise) instead of being created idle and then written to, so calling `find` from inside an effect — e.g. a synchronous React render — no longer runs the outer batch's later effects nested inside it (which surfaced as React "setState in render" errors). Fixes #144.
