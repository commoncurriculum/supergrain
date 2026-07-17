---
"@supergrain/kernel": minor
---

Add a `returnStableReference` option to `computed`. `computed(getter, {
returnStableReference: true })` keeps one persistent reactive array and
reconciles it in place to match the getter's result, so the returned reference
never changes across recomputes (`use()` / `<For>` / dependency arrays don't
churn), reads stay fine-grained (only changed slots notify), and the computed
still firewalls (an equal re-run doesn't propagate). With no options, `computed`
is unchanged — it returns the underlying alien-signals computed as before.
