---
"@supergrain/kernel": patch
---

`tracked` components no longer throw away the cached state of the computeds they read each time they re-render. Before, when a component was told to re-render, its effect dropped every subscription, so each computed it read had no subscribers left and was rebuilt from scratch on the next render. Now each render subscribes with a fresh effect, and the previous one is dropped only after that render. A `liveQuery` read in a `tracked` component now does one row's work per change instead of rechecking every row.
