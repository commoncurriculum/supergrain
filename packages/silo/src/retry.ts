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

/**
 * The built-in default `deadline`: the overall budget across all attempts of
 * one fetch, applied whenever no `deadline` is set (per-model / per-query /
 * store-wide). Two minutes ≈ ten attempts of the fibonacci backoff — long
 * enough to ride out a deploy blip or a slow mobile link, short enough that a
 * down backend eventually settles the terminal `error` (rejecting the handle's
 * promise, so Suspense error boundaries fire) instead of spinning forever.
 *
 * Opt out with `deadline: Duration.infinity` to retry without bound.
 */
export const defaultDeadline: Duration.Duration = Duration.minutes(2);

/**
 * {@link defaultRetry} bounded to 3 recurrences (4 attempts, ~1s + 1s + 2s of
 * jittered backoff). Used by the finder for a multi-key chunk with
 * `isolateFailures` when no `retry` was configured anywhere: isolation only
 * engages on a *terminal* failure, which the never-give-up `defaultRetry`
 * never reaches — so an isolating chunk trades "retry until the deadline" for
 * "fail terminally after a few attempts, then bisect". An explicitly
 * configured `retry` (even an unbounded one) is honored as-is.
 */
export const boundedDefaultRetry: Schedule.Schedule<unknown, AdapterError> = Schedule.intersect(
  defaultRetry,
  Schedule.recurs(3),
);
