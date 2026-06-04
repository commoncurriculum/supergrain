---
"@supergrain/queries": minor
"@supergrain/silo": minor
---

Harden the shared retry engine so a retrying fetch is observable, bounded, and
doesn't retry the unretryable — and stop leaking the store's raw defaults.

**Failures are visible while retrying.** A handle now carries `failureCount` and
`lastError` alongside the terminal `error`, and `onError` fires on **every failed
attempt** (not just on give-up). Under the infinite default retry a down backend
used to show a silent spinner — no `error`, no telemetry — until it gave up
(never). Now each attempt bumps `failureCount` / `lastError` and notifies
`onError`, so the outage is observable mid-retry; both reset to `0` / `undefined`
on success. `@supergrain/queries`' `Query` exposes the same `failureCount` /
`lastError`.

**The default backoff is jittered.** `defaultRetry` is now jittered fibonacci
(0.8–1.2× spread, clamped to 60s) so concurrent clients hitting a recovering
endpoint don't retry in lockstep.

**Retries respect retryability.** `AdapterError` takes an optional
`retryable?: boolean`; a `retry` schedule only re-runs while the error is
retryable (the default). Effect adapters mark a deterministic failure
`retryable: false` to fail fast. Promise-first adapters — which reject rather
than construct the error — get a config-level `retryable?: (error) => boolean`
classifier (model / query / store, and `createQuery`) that inspects
`error.cause` (e.g. a `Response`'s status); the error's own `retryable: false`
remains a hard veto over the predicate.

**A throwing failure sink can't break the engine.** `onError` now fires per
attempt, and `runAdapter` isolates it (and the `deadline` breach notification)
in try/catch — the same contract the finder already kept for terminal
`onError`, now honored on every per-attempt and deadline path.

**Enriched `onError` context.** The sink now receives
`{ type, keys, attempt, retryable }` — the 1-based attempt number and whether
the failure passed the retryable check — so telemetry can chart retry rate or
alert only on hard (`retryable: false`) failures. Additive; existing
`{ type, keys }` destructuring is unaffected.

**Overall deadline.** A new `deadline` knob (model / query / store, and
`createQuery`) caps **all** attempts together, including retry backoff —
distinct from the per-attempt `timeout`. On expiry the fetch fails with a
non-retryable `AdapterError`, so the infinite default retry can be made to
terminate.

**Structured failure reasons.** `AdapterError` carries `reason?: "adapter" |
"timeout" | "deadline"` so consumers branch on a stable tag instead of
regex-matching `cause.message`.

**Poison-id isolation (`isolateFailures`).** Opt-in (model / query / store):
when a multi-id batch fails terminally, the chunk is bisected and the halves
re-fetched once, isolating the offending id so its healthy batch-mates still
load instead of all failing together. Off by default.

**Bounded fan-out (`maxConcurrency`).** New store-wide
`maxConcurrency?: number | "unbounded"` (default `"unbounded"`) caps how many
`adapter.find` chunks run at once, so a large render (many chunks) doesn't
fire every request simultaneously.

**Hardened query cache keys.** `stableStringify` now encodes non-finite numbers
(`NaN` / `±Infinity`) distinctly — they previously all collapsed to `null` via
`JSON.stringify`, colliding on one cache slot — and throws a clear error on
cyclic params instead of overflowing the stack.

**Breaking — `store.defaults` → `store.resolveAdapterOptions(perCall?)`.** The
read-only `defaults` field is replaced by a method that merges per-call overrides
over the store-wide `retry` / `timeout` / `deadline` (falling back to
`defaultRetry`). Resolution now lives in one place instead of leaking the store's
raw defaults onto its public surface. Layered helpers like `@supergrain/queries`
call it.

```diff
- const { retry, timeout } = store.defaults;
+ const { retry, timeout, deadline } = store.resolveAdapterOptions(perCallOverrides);
```
