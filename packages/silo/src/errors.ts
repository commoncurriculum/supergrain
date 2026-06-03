// oxlint-disable max-classes-per-file -- three small related tagged-error classes
// oxlint-disable new-cap -- `Data.TaggedError("Tag")` is Effect's tagged-error idiom
import { Data, Effect } from "effect";

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
