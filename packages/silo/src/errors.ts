// oxlint-disable max-classes-per-file -- three small related tagged-error classes
// oxlint-disable new-cap -- `Data.TaggedError("Tag")` is Effect's tagged-error idiom
import { Data } from "effect";

/**
 * Why an {@link AdapterError} was raised. Omitted means `"adapter"`.
 * - `"adapter"` — the adapter failed (network error, non-2xx, rejection).
 * - `"timeout"` — a per-attempt `timeout` elapsed.
 * - `"deadline"` — the overall `deadline` across all attempts elapsed.
 * - `"defect"` — an unexpected throw (a bug); `cause` holds it. Never retried.
 */
export type AdapterErrorReason = "adapter" | "timeout" | "deadline" | "defect";

/**
 * The adapter's `find` Effect failed. `keys` are document ids or stringified
 * query params.
 */
export class AdapterError extends Data.TaggedError("AdapterError")<{
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  readonly cause: unknown;
  /**
   * Omitted means retryable. Set `false` for failures retrying can't fix (a 4xx)
   * so the fetch fails fast.
   */
  readonly retryable?: boolean;
  /** Branch on this rather than parsing {@link AdapterError.cause}'s message. */
  readonly reason?: AdapterErrorReason;
}> {
  override get message(): string {
    return `@supergrain/silo: adapter for "${this.type}" failed for [${this.keys.join(", ")}]`;
  }
}

/** The fetch succeeded but the response didn't contain the requested `(type, key)`. */
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly type: string;
  readonly key: string;
}> {
  override get message(): string {
    return `@supergrain/silo: not found after fetch: ${this.type}:${this.key}`;
  }
}

/** The response processor threw. */
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

export function defectToAdapterError(
  type: string,
  keys: ReadonlyArray<string>,
  defect: unknown,
): AdapterError {
  return new AdapterError({ type, keys, cause: defect, retryable: false, reason: "defect" });
}

export function runProcessor(type: string, run: () => void): ProcessorError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    return new ProcessorError({ type, cause: error });
  }
}
