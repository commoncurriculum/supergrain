import type { AdapterError, SiloError } from "./errors";
import type { Duration, Schedule } from "effect";

import { defaultDeadline, defaultRetry } from "./retry";

/** The resilience knobs a caller may override per fetch. */
export interface AdapterOptionOverrides {
  /** Re-run the attempt on a retryable `AdapterError` per this `Schedule`. */
  readonly retry?: Schedule.Schedule<unknown, AdapterError>;
  /** Wrap each attempt; a per-attempt timeout becomes a retryable `AdapterError`. */
  readonly timeout?: Duration.DurationInput;
  /**
   * Overall budget across all attempts, including backoff. When it elapses the
   * fetch fails with a non-retryable `AdapterError` (`reason: "deadline"`).
   * Defaults to {@link defaultDeadline}; `Duration.infinity` retries without bound.
   */
  readonly deadline?: Duration.DurationInput;
  /**
   * Classify a failure as retryable, for adapters that reject instead of building
   * an `AdapterError`. Inspect `error.cause`, e.g.
   * `(e) => !(e.cause instanceof Response) || e.cause.status >= 500`.
   * An error with `retryable: false` is never retried regardless.
   */
  readonly retryable?: (error: AdapterError) => boolean;
}

/** Resilience options accepted per model, per query, and store-wide. */
export interface ResilienceOptions extends AdapterOptionOverrides {
  /**
   * When a multi-key `adapter.find` chunk fails terminally, bisect it and
   * re-fetch the halves once each so one bad key doesn't fail its neighbors.
   * A `deadline` failure is never bisected. With no `retry` configured, the
   * chunk uses `boundedDefaultRetry`. Off by default.
   */
  readonly isolateFailures?: boolean;
}

/** The per-failure context handed to {@link AdapterErrorSink}. */
export interface AdapterErrorContext {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /** 1-based attempt number this failure belongs to. */
  readonly attempt: number;
  /** Whether the failure passed the retryable check. */
  readonly retryable: boolean;
}

/**
 * `DocumentStoreConfig.onError`: called on every failed attempt and terminal
 * failure, for documents and queries. Errors it throws are swallowed.
 */
export type AdapterErrorSink = (error: SiloError, ctx: AdapterErrorContext) => void;

/** Fully-resolved resilience options, ready to hand to `runAdapter`. */
export interface ResolvedAdapterOptions {
  readonly retry: Schedule.Schedule<unknown, AdapterError>;
  /** True when no `retry` was configured anywhere and the default was used. */
  readonly retryIsDefault: boolean;
  readonly timeout: Duration.DurationInput | undefined;
  readonly deadline: Duration.DurationInput;
  readonly retryable: ((error: AdapterError) => boolean) | undefined;
  readonly onError: AdapterErrorSink | undefined;
}

export function resolveAdapterOptions(
  defaults: AdapterOptionOverrides & { onError?: AdapterErrorSink },
  perCall?: AdapterOptionOverrides,
): ResolvedAdapterOptions {
  const configuredRetry = perCall?.retry ?? defaults.retry;
  return {
    retry: configuredRetry ?? defaultRetry,
    retryIsDefault: configuredRetry === undefined,
    timeout: perCall?.timeout ?? defaults.timeout,
    deadline: perCall?.deadline ?? defaults.deadline ?? defaultDeadline,
    retryable: perCall?.retryable ?? defaults.retryable,
    onError: defaults.onError,
  };
}

export function emitToSink(
  sink: AdapterErrorSink | undefined,
  error: SiloError,
  ctx: AdapterErrorContext,
): void {
  if (sink === undefined) return;
  try {
    sink(error, ctx);
  } catch {
    // A throwing telemetry callback must never break the fetch.
  }
}
