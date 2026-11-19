import type { AdapterOptionOverrides } from "./resolve";

import { Duration, Effect } from "effect";

import { AdapterError, defectToAdapterError } from "./errors";

function isRetryable(error: AdapterError): boolean {
  return error.retryable !== false;
}

function coerceAdapter<A>(
  result: Promise<A> | Effect.Effect<A, AdapterError>,
  type: string,
  keys: ReadonlyArray<string>,
): Effect.Effect<A, AdapterError> {
  return Effect.isEffect(result)
    ? result
    : Effect.tryPromise({
        try: () => result,
        catch: (cause) =>
          cause instanceof AdapterError ? cause : new AdapterError({ type, keys, cause }),
      });
}

export interface AdapterRunOptions extends AdapterOptionOverrides {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /**
   * Called for each failed attempt and for a `deadline` breach, not for
   * interruptions. Throws are swallowed.
   */
  readonly onFailure?: (error: AdapterError, info: AdapterFailureInfo) => void;
  /** Bounds concurrent attempts. A permit is released during retry backoff. */
  readonly permits?: Effect.Semaphore;
}

/** Per-failure context handed to `onFailure`. */
export interface AdapterFailureInfo {
  /** 1-based attempt number. */
  readonly attempt: number;
  /** Whether the failure passed the retryable check; the schedule may still be exhausted. */
  readonly retryable: boolean;
}

export function runAdapter<A>(
  invoke: (ctx: { signal: AbortSignal }) => Promise<A> | Effect.Effect<A, AdapterError>,
  options: AdapterRunOptions,
): Effect.Effect<A, AdapterError> {
  const { type, keys, retry, timeout, deadline, retryable, onFailure, permits } = options;

  let attemptCount = 0;

  const notifyFailure = (error: AdapterError, info: AdapterFailureInfo): void => {
    if (onFailure === undefined) return;
    try {
      onFailure(error, info);
    } catch {
      // Observability must not affect fetch state.
    }
  };

  const attempt = Effect.suspend(() => {
    const controller = new AbortController();
    // A sync throw escaping `Effect.suspend` becomes a defect that skips retry.
    try {
      return coerceAdapter(invoke({ signal: controller.signal }), type, keys).pipe(
        Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
      );
    } catch (error) {
      return Effect.fail(
        error instanceof AdapterError ? error : new AdapterError({ type, keys, cause: error }),
      );
    }
  }).pipe(Effect.catchAllDefect((defect) => Effect.fail(defectToAdapterError(type, keys, defect))));

  const timed =
    timeout === undefined
      ? attempt
      : attempt.pipe(
          Effect.timeoutFail({
            duration: timeout,
            onTimeout: () =>
              new AdapterError({
                type,
                keys,
                cause: new Error("adapter timed out"),
                reason: "timeout",
              }),
          }),
        );

  // Acquired outside the timeout so waiting for a permit can't time the attempt out.
  const gated = permits === undefined ? timed : permits.withPermits(1)(timed);

  // Stamp the classifier's veto onto the error so what consumers see matches the
  // retry decision, and an impure classifier runs once per failure.
  const classified =
    retryable === undefined
      ? gated
      : gated.pipe(
          Effect.mapError((error) => {
            if (!isRetryable(error) || retryable(error)) return error;
            // An Effect adapter may fail with a non-AdapterError despite its type.
            return error instanceof AdapterError
              ? new AdapterError({
                  type: error.type,
                  keys: error.keys,
                  cause: error.cause,
                  retryable: false,
                  reason: error.reason,
                })
              : error;
          }),
        );

  const observed =
    onFailure === undefined
      ? classified
      : classified.pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              attemptCount += 1;
              notifyFailure(error, { attempt: attemptCount, retryable: isRetryable(error) });
            }),
          ),
        );

  const retried =
    retry === undefined
      ? observed
      : observed.pipe(Effect.retry({ schedule: retry, while: isRetryable }));

  if (deadline === undefined || !Duration.isFinite(Duration.decode(deadline))) return retried;
  return retried.pipe(
    Effect.timeoutFail({
      duration: deadline,
      onTimeout: () => {
        const error = new AdapterError({
          type,
          keys,
          cause: new Error("adapter deadline exceeded"),
          retryable: false,
          reason: "deadline",
        });
        // The deadline interrupts the attempt, so `tapError` above never sees this.
        notifyFailure(error, { attempt: attemptCount + 1, retryable: false });
        return error;
      },
    }),
  );
}
