import type { AdapterError } from "./errors";

import { Duration, Schedule } from "effect";

/**
 * The built-in default retry `Schedule`, applied to every document and query
 * fetch that doesn't set its own `retry` (per-model / per-query) or a
 * store-wide `DocumentStoreConfig.retry`.
 *
 * Fibonacci backoff with a 1s base, **jittered** (Effect's default 0.8–1.2×
 * spread, so concurrent clients hitting a recovering endpoint don't retry in
 * lockstep — no thundering herd), each delay then clamped to 60s, retrying
 * **until success** (no recurrence cap). Shared by both surfaces, so a document
 * `find` and a `createQuery` fetch retry identically out of the box.
 *
 * Because retries run inside the in-flight fetch, a permanently-failing request
 * keeps `isFetching: true` and never settles the terminal `error`. It is **not**
 * silent, though: every failed attempt fires `onError` and bumps the handle's
 * `failureCount` / `lastError`, so an outage is observable while retrying. To
 * make it terminate instead, bound it with a `deadline`, a bounded schedule
 * (e.g. `Schedule.recurs(3)`), or disable retry with `Schedule.recurs(0)` at the
 * model, query, or store level.
 *
 * Jitter is applied before the clamp so the 60s ceiling is never exceeded.
 */
export const defaultRetry: Schedule.Schedule<unknown, AdapterError> = Schedule.fibonacci(
  Duration.seconds(1),
).pipe(
  Schedule.jittered,
  Schedule.modifyDelay((_output, delay) => Duration.min(delay, Duration.seconds(60))),
);
