import type { AdapterError } from "./errors";

import { Duration, Schedule } from "effect";

/**
 * The built-in default retry `Schedule`, applied to every document and query
 * fetch that doesn't set its own `retry` (per-model / per-query) or a
 * store-wide `DocumentStoreConfig.retry`.
 *
 * Fibonacci backoff with a 1s base, each delay clamped to 60s, retrying **until
 * success** (no recurrence cap). This matches the historical app behavior and
 * is shared by both surfaces, so a document `find` and a `createQuery` fetch
 * retry identically out of the box.
 *
 * Because retries run inside the in-flight fetch, a permanently-failing request
 * keeps `isFetching: true` and never settles `error`. To surface failures
 * instead, set a bounded schedule (e.g. `Schedule.recurs(3)`) or disable retry
 * with `Schedule.recurs(0)` at the model, query, or store level.
 */
export const defaultRetry: Schedule.Schedule<unknown, AdapterError> = Schedule.fibonacci(
  Duration.seconds(1),
).pipe(Schedule.modifyDelay((_output, delay) => Duration.min(delay, Duration.seconds(60))));
