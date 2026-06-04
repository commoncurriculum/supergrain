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

**Retries respect a retryable flag.** `AdapterError` takes an optional
`retryable?: boolean`. A `retry` schedule only re-runs while the error is
retryable (the default); mark a deterministic failure (e.g. a 4xx)
`retryable: false` and the fetch fails fast instead of looping.

**Overall deadline.** A new `deadline` knob (model / query / store, and
`createQuery`) caps **all** attempts together, including retry backoff —
distinct from the per-attempt `timeout`. On expiry the fetch fails with a
non-retryable `AdapterError` whose cause mentions "deadline", so the infinite
default retry can be made to terminate.

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
