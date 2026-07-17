---
"@supergrain/kernel": minor
---

Add `stableComputed(getter)` — a memoized derived array with a **stable
reference**. It keeps one persistent reactive array and reconciles it in place
to match the getter's result, so the returned reference never changes across
recomputes (`use()` / `<For>` / dependency arrays don't churn), reads stay
fine-grained (only changed slots notify), and it still firewalls (an equal
re-run doesn't propagate). `computed` is untouched — it remains the plain
alien-signals export.
