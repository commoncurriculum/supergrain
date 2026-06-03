import type { SiloError } from "./errors";
import type { HandleStatus } from "./store";
import type { Data } from "effect";

import { unwrap } from "@supergrain/kernel";

// =============================================================================
// Handle statechart — flat orthogonal fields, one event alphabet
// =============================================================================
//
// A handle exposes orthogonal fields — `value`, `error`, `isFetching`,
// `fetchedAt` — that vary independently (a stale `value` coexists with a
// refetch `error`). Transitions are modeled as an exhaustive reduction over a
// tagged event alphabet; `status` is derived from `value`/`error`. The promise
// lifecycle (React `use()` / Suspense) is layered on top in `applyEvent`.

export type HandleEvent<T = unknown, E = SiloError> = Data.TaggedEnum<{
  /** A (re)fetch started. */
  Fetch: Record<never, never>;
  /** A document/result was inserted (by a processor or `insertDocument`). */
  Insert: { readonly value: T };
  /** The in-flight fetch completed and the requested key is present. */
  Settled: Record<never, never>;
  /** The fetch (or processor) failed, or the key was missing after fetch. */
  Failed: { readonly error: E };
  /** Memory was cleared. */
  Reset: Record<never, never>;
}>;

/**
 * Event constructors. Lowercase (vs. `Data.taggedEnum`'s capitalized
 * constructors) since events are built from plain tagged literals — the
 * exhaustive reducer below is the statechart; `$match`/`$is` aren't needed.
 */
export const HandleEvent = {
  fetch: (): HandleEvent => ({ _tag: "Fetch" }),
  insert: <T>(value: T): HandleEvent<T> => ({ _tag: "Insert", value }),
  settled: (): HandleEvent => ({ _tag: "Settled" }),
  failed: (error: SiloError): HandleEvent => ({ _tag: "Failed", error }),
  reset: (): HandleEvent => ({ _tag: "Reset" }),
};

/** `status` is derived from the orthogonal fields, never stored as truth. */
function deriveStatus(value: unknown, error: unknown): HandleStatus {
  if (value !== undefined) return "success"; // a value exists, even if a refetch errored
  if (error !== undefined) return "error"; // first-load failure, no value yet
  return "pending";
}

// ─── The mutable handle the store/finder operate on ──────────────────────────

/**
 * Internal handle — the reactive object behind the public `DocumentHandle` /
 * `QueryHandle`. Carries the flat fields plus the resolver functions for the
 * in-flight promise. The public type hides `resolve` / `reject`.
 */
export interface InternalHandle<T = unknown, E = SiloError> {
  value: T | undefined;
  error: E | undefined;
  isFetching: boolean;
  fetchedAt: Date | undefined;
  status: HandleStatus;
  promise: Promise<T> | undefined;
  resolve?: (v: T) => void;
  reject?: (e: unknown) => void;
}

export function makeIdleHandle<T = unknown, E = SiloError>(): InternalHandle<T, E> {
  return {
    value: undefined,
    error: undefined,
    isFetching: false,
    fetchedAt: undefined,
    status: "pending",
    promise: undefined,
    resolve: undefined,
    reject: undefined,
  };
}

// ─── Promise plumbing ────────────────────────────────────────────────────────

export interface Resolvers<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function withResolvers<T>(): Resolvers<T> {
  // eslint-disable-next-line unicorn/no-null -- Promise ctor synchronously overwrites these
  let resolve = null as unknown as (v: T) => void;
  // eslint-disable-next-line unicorn/no-null -- Promise ctor synchronously overwrites these
  let reject = null as unknown as (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Apply one event to a handle: compute the next flat field values, write only
 * the ones that changed, then settle the promise lifecycle.
 *
 * State is read UNTRACKED via the raw target, but written through the reactive
 * proxy. Reading the proxy here would subscribe any tracked scope that calls
 * (say) `insertDocument` during render to the very fields it mutates — a
 * self-triggering loop. Reading raw avoids that; per-field writes below still
 * notify genuine readers. Writing only changed fields preserves the kernel's
 * per-field reactivity (a `value` reader doesn't re-render when `isFetching`
 * toggles on a background refetch).
 */
export function applyEvent<T>(handle: InternalHandle<T>, event: HandleEvent<T, SiloError>): void {
  const raw = unwrap(handle);
  const hadValue = raw.value !== undefined;
  const wasFetching = raw.isFetching;

  let { value, error, isFetching, fetchedAt } = raw;

  switch (event._tag) {
    case "Fetch": {
      // Stale-while-revalidate: keep value/error; just mark activity.
      isFetching = true;
      break;
    }
    case "Insert": {
      ({ value } = event);
      fetchedAt = new Date();
      error = undefined; // fresh data supersedes any prior error
      break;
    }
    case "Settled": {
      isFetching = false;
      error = undefined;
      break;
    }
    case "Failed": {
      // Keep value (stale-while-revalidate); record the error, end activity.
      ({ error } = event);
      isFetching = false;
      break;
    }
    case "Reset": {
      value = undefined;
      error = undefined;
      fetchedAt = undefined;
      // An in-flight fetch survives a reset (isFetching unchanged) and will
      // repopulate; otherwise everything clears.
      break;
    }
  }

  const status = deriveStatus(value, error);

  if (raw.value !== value) handle.value = value;
  if (raw.error !== error) handle.error = error;
  if (raw.isFetching !== isFetching) handle.isFetching = isFetching;
  if (raw.fetchedAt !== fetchedAt) handle.fetchedAt = fetchedAt;
  if (raw.status !== status) handle.status = status;

  switch (event._tag) {
    case "Fetch": {
      if (raw.promise === undefined) {
        const r = withResolvers<T>();
        // Suppress unhandled-rejection warnings; users still observe via await.
        r.promise.catch(() => {});
        handle.promise = r.promise;
        raw.resolve = r.resolve;
        raw.reject = r.reject;
      }
      break;
    }
    case "Insert": {
      if (raw.resolve) {
        raw.resolve(event.value);
        raw.resolve = undefined;
        raw.reject = undefined;
      } else if (!hadValue) {
        // Insert into an errored/idle handle: hand out a fresh resolved promise
        // so a Suspense boundary nested in an error boundary can recover.
        handle.promise = Promise.resolve(event.value);
      }
      break;
    }
    case "Settled": {
      if (raw.resolve && raw.value !== undefined) {
        raw.resolve(raw.value);
        raw.resolve = undefined;
        raw.reject = undefined;
      }
      break;
    }
    case "Failed": {
      // Reject only a first-load failure (no value yet) with a pending
      // resolver. A refetch error after a prior success leaves the already
      // resolved promise alone.
      if (raw.reject && raw.value === undefined) {
        raw.reject(event.error);
        raw.resolve = undefined;
        raw.reject = undefined;
      }
      break;
    }
    case "Reset": {
      if (!wasFetching) {
        handle.promise = undefined;
        raw.resolve = undefined;
        raw.reject = undefined;
      }
      break;
    }
  }
}
