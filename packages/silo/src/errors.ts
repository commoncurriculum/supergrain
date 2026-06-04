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
}> {
  override get message(): string {
    return `@supergrain/silo: adapter for "${this.type}" failed for [${this.keys.join(", ")}]`;
  }
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
  /** Re-run the attempt on `AdapterError` per this `Schedule`. */
  readonly retry?: Schedule.Schedule<unknown, AdapterError>;
  /** Wrap each attempt; a timeout becomes an `AdapterError`. */
  readonly timeout?: Duration.DurationInput;
}

/**
 * Turn one consumer adapter call into a typed, resilient, abortable Effect —
 * the single engine entrypoint shared by `@supergrain/silo`'s finder and
 * `@supergrain/queries`, so both apply `retry` / `timeout` / abort identically.
 *
 * - A fresh `AbortController` is created **per attempt** (inside
 *   `Effect.suspend`, so a `retry` gets a new signal each time). On
 *   interruption — a `timeout` firing, a retry abandoning the prior attempt, or
 *   the caller cancelling — the controller aborts, so an adapter that threaded
 *   `signal` into `fetch` tears its request down.
 * - The Promise→`AdapterError` boundary is delegated to {@link coerceAdapter}.
 * - `timeout` wraps each attempt; `retry` re-runs it on `AdapterError`.
 */
export function runAdapter<A>(
  invoke: (ctx: { signal: AbortSignal }) => Promise<A> | Effect.Effect<A, AdapterError>,
  options: AdapterRunOptions,
): Effect.Effect<A, AdapterError> {
  const { type, keys, retry, timeout } = options;
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
  return retry === undefined ? timed : timed.pipe(Effect.retry(retry));
}
