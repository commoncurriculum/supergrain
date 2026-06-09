import type { AdapterError, SiloError } from "./errors";
import type { Duration, Schedule } from "effect";

import { defaultRetry } from "./retry";

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
  readonly timeout: Duration.DurationInput | undefined;
  readonly deadline: Duration.DurationInput | undefined;
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
 * built-in {@link defaultRetry} when no `retry` is set anywhere. `timeout`,
 * `deadline`, and the `retryable` classifier are off unless configured. The
 * store's `onError` sink is passed through (it is store-level telemetry, not a
 * per-call knob).
 */
export function resolveAdapterOptions(
  defaults: AdapterOptionOverrides & { onError?: AdapterErrorSink },
  perCall?: AdapterOptionOverrides,
): ResolvedAdapterOptions {
  return {
    retry: perCall?.retry ?? defaults.retry ?? defaultRetry,
    timeout: perCall?.timeout ?? defaults.timeout,
    deadline: perCall?.deadline ?? defaults.deadline,
    retryable: perCall?.retryable ?? defaults.retryable,
    onError: defaults.onError,
  };
}
