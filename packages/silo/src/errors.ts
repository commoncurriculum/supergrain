// oxlint-disable max-classes-per-file -- three small related tagged-error classes
// oxlint-disable new-cap -- `Data.TaggedError("Tag")` is Effect's tagged-error idiom
import { Data, type Duration, Effect, type Schedule } from "effect";

// =============================================================================
// Typed errors
// =============================================================================
//
// All silo failures are `Data.TaggedError`s — discriminated on `_tag`, still
// `instanceof Error`, and pattern-matchable with `Match`/`catchTag`. They are
// the `E` channel of the adapter `Effect`s and the `error` carried by a
// handle's `FetchState.Failed`.

/**
 * The adapter's `find` Effect failed (network error, non-2xx, thrown in
 * `Effect.tryPromise`, …). Carries the requested `type` and `keys` (document
 * ids or stringified query params) plus the underlying `cause`.
 */
export class AdapterError extends Data.TaggedError("AdapterError")<{
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  readonly cause: unknown;
  /**
   * Whether a `retry` schedule should re-run after this failure. Omitted (the
   * common case) means **retryable** — a network blip, a 5xx, a coerced Promise
   * rejection. Set `false` for a deterministic failure that retrying can't fix
   * (a 4xx, a malformed request) so the fetch fails fast instead of looping.
   */
  readonly retryable?: boolean;
}> {
  override get message(): string {
    return `@supergrain/silo: adapter for "${this.type}" failed for [${this.keys.join(", ")}]`;
  }
}

/** An `AdapterError` is retryable unless it explicitly opts out (`retryable: false`). */
function isRetryable(error: AdapterError): boolean {
  return error.retryable !== false;
}

/**
 * The adapter succeeded and the processor ran, but the requested `(type, key)`
 * was not inserted into the store — i.e. the response didn't contain it.
 */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly type: string;
  readonly key: string;
}> {
  override get message(): string {
    return `@supergrain/silo: not found after fetch: ${this.type}:${this.key}`;
  }
}

/**
 * The response processor threw while normalizing the adapter response.
 */
export class ProcessorError extends Data.TaggedError("ProcessorError")<{
  readonly type: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `@supergrain/silo: processor for "${this.type}" threw`;
  }
}

/** Every error a handle's `FetchState.Failed` can carry. */
export type SiloError = AdapterError | NotFoundError | ProcessorError;

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
export function coerceAdapter<A>(
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

/** Per-call resilience knobs, identical to `ModelConfig` / `QueryConfig`. */
export interface AdapterRunOptions {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /** Re-run the attempt on a retryable `AdapterError` per this `Schedule`. */
  readonly retry?: Schedule.Schedule<unknown, AdapterError>;
  /** Wrap each attempt; a per-attempt timeout becomes a retryable `AdapterError`. */
  readonly timeout?: Duration.DurationInput;
  /**
   * Overall budget across *all* attempts, including retry backoff. When it
   * elapses the whole program fails with a non-retryable `AdapterError` whose
   * cause mentions "deadline", however many retries remained. Distinct from
   * `timeout`, which bounds a single attempt — pair them so neither a hung
   * request nor an unlucky retry loop runs unbounded.
   */
  readonly deadline?: Duration.DurationInput;
  /**
   * Classify a failure as retryable. Lets a **Promise-first** adapter — which
   * rejects rather than constructing an `AdapterError`, so it can't set the
   * error's own `retryable` flag — decide from the coerced error (inspect
   * `error.cause`, e.g. a `Response`'s status) whether to keep retrying. A `4xx`
   * is typically deterministic: `(e) => !(e.cause instanceof Response) ||
   * e.cause.status >= 500`. An error that opts out via its own
   * `retryable: false` is a hard veto regardless of this predicate.
   */
  readonly retryable?: (error: AdapterError) => boolean;
  /**
   * Observe every failure the caller should see: each failed attempt — so a
   * still-retrying fetch is never silent — and a `deadline` breach. Not called
   * on interruption (a superseded or timed-out attempt). Side-effecting sink
   * for telemetry / handle bookkeeping; a throw is swallowed so observability
   * can't break the engine.
   */
  readonly onFailure?: (error: AdapterError) => void;
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
  const { type, keys, retry, timeout, deadline, retryable, onFailure } = options;

  // A throwing failure sink must never break the engine — same contract the
  // finder already keeps for `onError`.
  const notifyFailure = (error: AdapterError): void => {
    if (onFailure === undefined) return;
    try {
      onFailure(error);
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
    return coerceAdapter(invoke({ signal: controller.signal }), type, keys).pipe(
      Effect.onInterrupt(() => Effect.sync(() => controller.abort())),
    );
  });

  const timed =
    timeout === undefined
      ? attempt
      : attempt.pipe(
          Effect.timeoutFail({
            duration: timeout,
            onTimeout: () =>
              new AdapterError({ type, keys, cause: new Error("adapter timed out") }),
          }),
        );

  // Report each attempt's failure *before* the retry decision, so every failed
  // attempt is observed — including the one that becomes terminal — not just
  // the final give-up. Interruptions never hit the error channel, so a
  // superseded / timed-out attempt is correctly not reported here.
  const observed =
    onFailure === undefined
      ? timed
      : timed.pipe(Effect.tapError((error) => Effect.sync(() => notifyFailure(error))));

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
        });
        // The deadline interrupts the in-flight attempt, so this error never
        // reaches the per-attempt `tapError`; report it here so the breach is
        // observed exactly once.
        notifyFailure(error);
        return error;
      },
    }),
  );
}
