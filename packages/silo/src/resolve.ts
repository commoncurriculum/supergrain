import type { AdapterError, SiloError } from "./errors";
import type { Duration, Schedule } from "effect";

import { defaultDeadline, defaultRetry } from "./retry";

// =============================================================================
// Adapter option resolution — the single merge point
// =============================================================================
//
// One place decides how per-call resilience knobs layer over store-wide
// defaults. Both the finder (per-model / per-query over store config) and
// `@supergrain/queries` (per-`createQuery` over the store) go through this, so
// a query fetch resolves its retry/timeout/deadline exactly like a document
// `find`. Replaces the former `store.defaults` field, which leaked the store's
// raw resolution state onto the public surface.

/** The resilience knobs a caller may override per fetch. */
export interface AdapterOptionOverrides {
  /** Re-run the attempt on a retryable `AdapterError` per this `Schedule`. */
  readonly retry?: Schedule.Schedule<unknown, AdapterError>;
  /** Wrap each attempt; a per-attempt timeout becomes a retryable `AdapterError`. */
  readonly timeout?: Duration.DurationInput;
  /**
   * Overall budget across *all* attempts, including retry backoff. When it
   * elapses the whole program fails with a non-retryable `AdapterError` tagged
   * `reason: "deadline"`, however many retries remained. Distinct from
   * `timeout`, which bounds a single attempt. Defaults to the built-in
   * {@link defaultDeadline} (2 minutes) so the never-give-up default retry
   * always terminates eventually; set `Duration.infinity` to retry without
   * bound.
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
}

/**
 * The resilience knobs accepted at every config level (model / query / store):
 * the engine knobs ({@link AdapterOptionOverrides}) plus the finder's
 * chunk-level `isolateFailures`. Declared once so the three levels can't drift.
 */
export interface ResilienceOptions extends AdapterOptionOverrides {
  /**
   * When a multi-key `adapter.find` chunk fails terminally, split it and
   * re-fetch the halves to **isolate** the offending key — so one bad record
   * (a 500 on a single id) doesn't fail the whole batch, and its healthy
   * neighbors still load. The sub-fetches run once (no retry; the chunk
   * already exhausted its schedule), and a `deadline` breach is never bisected
   * (the deadline is the caller's hard stop). With the never-give-up
   * {@link defaultRetry}, an isolating chunk uses a bounded variant of it so a
   * terminal failure — and therefore isolation — is actually reachable; an
   * explicitly configured `retry` is honored as-is. Off by default. Best for
   * bulk endpoints; under a full backend outage every key will still
   * ultimately fail (bisection just adds a bounded fan-out before giving up).
   *
   * Resolution precedence: per-model / per-query → store-wide → off.
   */
  readonly isolateFailures?: boolean;
}

/** The per-failure context handed to {@link AdapterErrorSink}. */
export interface AdapterErrorContext {
  readonly type: string;
  readonly keys: ReadonlyArray<string>;
  /** 1-based attempt number this failure belongs to. */
  readonly attempt: number;
  /** Whether the failure is eligible for retry (passed the retryable check). */
  readonly retryable: boolean;
}

/**
 * The store's telemetry sink (`DocumentStoreConfig.onError`): called on every
 * failed attempt and on terminal failures, for documents and queries alike. A
 * throwing sink is always swallowed — observability can't affect fetch state.
 */
export type AdapterErrorSink = (error: SiloError, ctx: AdapterErrorContext) => void;

/** Fully-resolved resilience options, ready to hand to `runAdapter`. */
export interface ResolvedAdapterOptions {
  readonly retry: Schedule.Schedule<unknown, AdapterError>;
  /**
   * True when `retry` is the built-in {@link defaultRetry} *fallback* — no
   * `retry` was configured per-call or store-wide. The finder uses this to
   * substitute the bounded default for an isolating chunk; provenance is
   * tracked here (not by comparing `retry` against `defaultRetry` by
   * reference) so an *explicitly* configured `defaultRetry` is honored as-is.
   */
  readonly retryIsDefault: boolean;
  readonly timeout: Duration.DurationInput | undefined;
  /** Always set: the configured deadline, falling back to {@link defaultDeadline}. */
  readonly deadline: Duration.DurationInput;
  readonly retryable: ((error: AdapterError) => boolean) | undefined;
  /**
   * The store's `onError` telemetry sink, passed through so layered helpers
   * (e.g. `@supergrain/queries`) report failures to the same place the finder
   * does — `onError` fires for every surface, not just document fetches.
   */
  readonly onError: AdapterErrorSink | undefined;
}

/**
 * Merge `perCall` overrides over the store-wide `defaults`, falling back to the
 * built-in {@link defaultRetry} when no `retry` is set anywhere and the
 * built-in {@link defaultDeadline} when no `deadline` is set anywhere (so the
 * infinite default retry always terminates — opt out with
 * `Duration.infinity`). `timeout` and the `retryable` classifier are off
 * unless configured. The store's `onError` sink is passed through (it is
 * store-level telemetry, not a per-call knob).
 */
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

/**
 * Notify an optional telemetry sink of one failure. A throwing sink is always
 * swallowed — observability can't affect fetch state. The one sink-call rule
 * shared by the finder, `store.runAdapter`, and `@supergrain/queries`, so the
 * swallow contract can't drift between surfaces.
 */
export function emitToSink(
  sink: AdapterErrorSink | undefined,
  error: SiloError,
  ctx: AdapterErrorContext,
): void {
  if (sink === undefined) return;
  try {
    sink(error, ctx);
  } catch {
    // Swallowed: a throwing telemetry callback must never break the engine.
  }
}
