import type { AdapterError } from "./errors";
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
  /** Per-attempt timeout; a timeout becomes a retryable `AdapterError`. */
  readonly timeout?: Duration.DurationInput;
  /** Overall budget across all attempts; a breach is a non-retryable `AdapterError`. */
  readonly deadline?: Duration.DurationInput;
}

/** Fully-resolved resilience options, ready to hand to `runAdapter`. */
export interface ResolvedAdapterOptions {
  readonly retry: Schedule.Schedule<unknown, AdapterError>;
  readonly timeout: Duration.DurationInput | undefined;
  readonly deadline: Duration.DurationInput | undefined;
}

/**
 * Merge `perCall` overrides over the store-wide `defaults`, falling back to the
 * built-in {@link defaultRetry} when no `retry` is set anywhere. `timeout` and
 * `deadline` are off unless configured.
 */
export function resolveAdapterOptions(
  defaults: AdapterOptionOverrides,
  perCall?: AdapterOptionOverrides,
): ResolvedAdapterOptions {
  return {
    retry: perCall?.retry ?? defaults.retry ?? defaultRetry,
    timeout: perCall?.timeout ?? defaults.timeout,
    deadline: perCall?.deadline ?? defaults.deadline,
  };
}
