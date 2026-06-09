import type { AdapterOptionOverrides } from "./resolve";

import { Effect } from "effect";

import { AdapterError } from "./errors";

// =============================================================================
// runAdapter — the adapter engine
// =============================================================================
//
// Turns one consumer adapter call into a typed, resilient, abortable Effect.
// This is the single engine entrypoint shared by `@supergrain/silo`'s finder
// and `@supergrain/queries`, so `retry` / `timeout` / `deadline` / abort behave
// identically on every surface.

/** An `AdapterError` is retryable unless it explicitly opts out (`retryable: false`). */
function isRetryable(error: AdapterError): boolean {
  return error.retryable !== false;
}

/**
 * Normalize an adapter result — a `Promise` (the common case) or an `Effect`
 * (opt-in) — into the engine's typed failure channel.
 *
 * A `Promise` is wrapped so a rejection becomes an `AdapterError` carrying
 * `type` / `keys` / `cause`; a rejection that is *already* an `AdapterError`
 * passes through untouched. An `Effect` is used as-is (the adapter owns its
 * failure channel).
 *
 * This is the single Promise→`AdapterError` boundary shared by `@supergrain/silo`'s
 * finder and `@supergrain/queries` so the rule lives in exactly one place.
 */
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

/**
 * What one engine run needs beyond the resilience knobs it inherits from
 * {@link AdapterOptionOverrides}: the failing `type` / `keys` for error
 * construction, an optional failure observer, and an optional concurrency
 * gate.
 */
export interface AdapterRunOptions extends AdapterOptionOverrides {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /**
   * Observe every failure the caller should see: each failed attempt — so a
   * still-retrying fetch is never silent — and a `deadline` breach. Not called
   * on interruption (a superseded or timed-out attempt). `info.attempt` is the
   * 1-based attempt number; `info.retryable` is whether the failure passed the
   * retryable check (the retry schedule may still be exhausted). Side-effecting
   * sink for telemetry / handle bookkeeping; a throw is swallowed so
   * observability can't break the engine.
   */
  readonly onFailure?: (error: AdapterError, info: AdapterFailureInfo) => void;
  /**
   * Optional semaphore bounding concurrent adapter **attempts**. Each attempt
   * (including its per-attempt `timeout`) holds one permit and releases it
   * during retry backoff, so a chunk sleeping between retries never starves
   * other work — and the bound composes across batch windows and bisection
   * recursion, which per-call-site concurrency caps cannot.
   */
  readonly permits?: Effect.Semaphore;
}

/** Per-failure context handed to {@link AdapterRunOptions.onFailure}. */
export interface AdapterFailureInfo {
  /** 1-based attempt number this failure belongs to. */
  readonly attempt: number;
  /** Whether the failure is eligible for retry (passed the retryable check). */
  readonly retryable: boolean;
}

/**
 * Turn one consumer adapter call into a typed, resilient, abortable Effect —
 * the single engine entrypoint shared by `@supergrain/silo`'s finder and
 * `@supergrain/queries`, so both apply `retry` / `timeout` / `deadline` / abort
 * identically.
 *
 * - A fresh `AbortController` is created **per attempt** (inside
 *   `Effect.suspend`, so a `retry` gets a new signal each time). On
 *   interruption — a `timeout` firing, a retry abandoning the prior attempt, or
 *   the caller cancelling — the controller aborts, so an adapter that threaded
 *   `signal` into `fetch` tears its request down.
 * - A **synchronous throw** from the adapter (thrown before returning a
 *   Promise/Effect) joins the typed failure channel as an `AdapterError`,
 *   exactly like a rejection — it must never escape as a defect that bypasses
 *   retry and the caller's error handling.
 * - The Promise→`AdapterError` boundary is delegated to {@link coerceAdapter}.
 * - `timeout` wraps each attempt; `onFailure` observes each attempt's failure
 *   (a throw is swallowed); `retry` re-runs only failures both the error's own
 *   `retryable` flag and the `retryable` predicate allow; `deadline` caps the
 *   whole loop.
 */
export function runAdapter<A>(
  invoke: (ctx: { signal: AbortSignal }) => Promise<A> | Effect.Effect<A, AdapterError>,
  options: AdapterRunOptions,
): Effect.Effect<A, AdapterError> {
  const { type, keys, retry, timeout, deadline, retryable, onFailure, permits } = options;

  // 1-based count of failed attempts observed so far, reported on `onFailure`.
  let attemptCount = 0;

  // A throwing failure sink must never break the engine — same contract the
  // finder already keeps for `onError`.
  const notifyFailure = (error: AdapterError, info: AdapterFailureInfo): void => {
    if (onFailure === undefined) return;
    try {
      onFailure(error, info);
    } catch {
      // Swallowed: observability can't affect fetch state.
    }
  };

  // Retry only when the error's own flag allows it (a `retryable: false` is a
  // hard veto — e.g. the deadline error) *and* the optional classifier agrees.
  const shouldRetry = (error: AdapterError): boolean =>
    isRetryable(error) && (retryable === undefined || retryable(error));

  const attempt = Effect.suspend(() => {
    const controller = new AbortController();
    // A synchronous throw from the adapter (before it returns a Promise or
    // Effect) is coerced here — letting it escape the suspend thunk would turn
    // it into a defect that bypasses retry, `onFailure`, and the caller's
    // typed error handling, stranding every waiting handle.
    try {
      return coerceAdapter(invoke({ signal: controller.signal }), type, keys).pipe(
        Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
      );
    } catch (error) {
      return Effect.fail(
        error instanceof AdapterError ? error : new AdapterError({ type, keys, cause: error }),
      );
    }
  });

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

  // One permit per attempt (held across the attempt's own `timeout`, released
  // during retry backoff). Acquiring outside the per-attempt timeout means
  // waiting for a permit can't spuriously time the attempt out.
  const gated = permits === undefined ? timed : permits.withPermits(1)(timed);

  // Report each attempt's failure *before* the retry decision, so every failed
  // attempt is observed — including the one that becomes terminal — not just
  // the final give-up. Interruptions never hit the error channel, so a
  // superseded / timed-out attempt is correctly not reported here.
  const observed =
    onFailure === undefined
      ? gated
      : gated.pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              attemptCount += 1;
              notifyFailure(error, { attempt: attemptCount, retryable: shouldRetry(error) });
            }),
          ),
        );

  // Retry only retryable failures; a hard failure (a 4xx the adapter marked
  // `retryable: false`, or one the `retryable` predicate rejects) fails fast.
  const retried =
    retry === undefined
      ? observed
      : observed.pipe(Effect.retry({ schedule: retry, while: shouldRetry }));

  if (deadline === undefined) return retried;
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
        // The deadline interrupts the in-flight attempt, so this error never
        // reaches the per-attempt `tapError`; report it here so the breach is
        // observed exactly once.
        notifyFailure(error, { attempt: attemptCount + 1, retryable: false });
        return error;
      },
    }),
  );
}
