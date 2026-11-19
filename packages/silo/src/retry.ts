import type { AdapterError } from "./errors";

import { Duration, Schedule } from "effect";

/**
 * Default retry `Schedule` for any fetch with no `retry` configured: jittered
 * Fibonacci backoff from 1s, each delay capped at 60s, with no recurrence cap
 * (the `deadline` ends it). While retrying, the handle stays `isFetching`, and
 * each failed attempt fires `onError` and updates `failureCount` / `lastError`.
 * Disable with `Schedule.recurs(0)`.
 */
export const defaultRetry: Schedule.Schedule<unknown, AdapterError> = Schedule.fibonacci(
  Duration.seconds(1),
).pipe(
  Schedule.jittered,
  Schedule.modifyDelay((_output, delay) => Duration.min(delay, Duration.seconds(60))),
);

/**
 * Default overall budget across all attempts of one fetch (about ten backoff
 * attempts). When it elapses the handle settles its `error`. Opt out with
 * `deadline: Duration.infinity`.
 */
export const defaultDeadline: Duration.Duration = Duration.minutes(2);

/**
 * {@link defaultRetry} capped at 3 recurrences. Used for `isolateFailures`
 * chunks when no `retry` is configured, since isolation only starts after a
 * terminal failure.
 */
export const boundedDefaultRetry: Schedule.Schedule<unknown, AdapterError> = Schedule.intersect(
  defaultRetry,
  Schedule.recurs(3),
);
