---
"@supergrain/kernel": minor
"@supergrain/husk": minor
---

Disposers now work with `using`. `effect(fn)` returns a `Disposer` — still callable as `stop()`, and also `Disposable`, so `using stop = effect(fn)` stops the effect at the end of the enclosing block. Husk's `resource`, `defineResource` instances, `reactivePromise`, and `reactiveTask` are `Disposable` too: `using` runs the same idempotent teardown as `dispose(x)`. The `Disposer` and `SymbolDisposable` types are exported from `@supergrain/kernel`; they fall back to plain types when your TypeScript `lib` doesn't declare `Symbol.dispose`, and runtimes without `Symbol.dispose` are unaffected.
