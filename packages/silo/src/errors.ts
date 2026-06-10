// oxlint-disable max-classes-per-file -- three small related tagged-error classes
// oxlint-disable new-cap -- `Data.TaggedError("Tag")` is Effect's tagged-error idiom
import { Data } from "effect";

// =============================================================================
// Typed errors
// =============================================================================
//
// All silo failures are `Data.TaggedError`s — discriminated on `_tag`, still
// `instanceof Error`, and pattern-matchable with `Match`/`catchTag`. They are
// the `E` channel of the adapter `Effect`s and the `error` a handle settles
// into when a fetch fails.

/**
 * Why an {@link AdapterError} was raised, so consumers branch on a stable tag
 * instead of regex-matching `cause.message`:
 * - `"adapter"` — the adapter itself failed (network error, non-2xx, rejection).
 * - `"timeout"` — a per-attempt `timeout` elapsed.
 * - `"deadline"` — the overall `deadline` across all attempts elapsed.
 * - `"defect"` — the fetch pipeline died unexpectedly (an unhandled throw
 *   outside the typed failure channel, e.g. a subscriber effect throwing while
 *   the commit flushed, or an adapter `Effect` dying). A bug, not a network
 *   failure — `cause` carries the original defect. Never retried.
 *
 * Omitted means `"adapter"` (the generic case).
 */
export type AdapterErrorReason = "adapter" | "timeout" | "deadline" | "defect";

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
  /**
   * Why this failed — `"adapter"` (default), `"timeout"`, or `"deadline"`.
   * Branch on this rather than parsing {@link AdapterError.cause}'s message.
   */
  readonly reason?: AdapterErrorReason;
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

/** Every error a handle's `error` field can carry. */
export type SiloError = AdapterError | NotFoundError | ProcessorError;

/**
 * Coerce a defect — an unexpected throw outside the typed failure channel —
 * into it: a non-retryable {@link AdapterError} tagged `reason: "defect"`.
 * The single defect rule shared by the engine (`runAdapter`), the finder's
 * chunk safety net, and `@supergrain/queries`, so the same crash settles into
 * the same error shape on every surface.
 */
export function defectToAdapterError(
  type: string,
  keys: ReadonlyArray<string>,
  defect: unknown,
): AdapterError {
  return new AdapterError({ type, keys, cause: defect, retryable: false, reason: "defect" });
}

/**
 * Run a processor/commit step, converting a throw into a
 * {@link ProcessorError}. Shared by the finder's chunk pipeline and
 * `@supergrain/queries`' commit step so the coercion rule can't drift.
 */
export function runProcessor(type: string, run: () => void): ProcessorError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return new ProcessorError({ type, cause: error });
  }
}
