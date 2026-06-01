import type { SiloError } from "./errors";
import type { DataState, FetchState } from "./store";

import { Data } from "effect";

// =============================================================================
// Handle statechart — two orthogonal regions, one event alphabet
// =============================================================================
//
// A handle is the product of two independent regions: `data` (Absent | Present)
// and `fetch` (Idle | Fetching | Failed). Transitions are modeled as a pure
// reduction over each region, driven by a single tagged event alphabet. The
// promise lifecycle (React `use()` / Suspense) is a side-effect layered on top
// in `applyEvent`, since it can't live in a pure reducer.

export type HandleEvent<T, E> = Data.TaggedEnum<{
  /** A (re)fetch started. */
  Fetch: {};
  /** A document/result was inserted (by a processor or `insertDocument`). */
  Insert: { readonly value: T };
  /** The in-flight fetch completed and the requested key is present. */
  Settled: {};
  /** The fetch (or processor) failed, or the key was missing after fetch. */
  Failed: { readonly error: E };
  /** Memory was cleared. */
  Reset: {};
}>;

interface HandleEventDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: HandleEvent<this["A"], this["B"]>;
}

export const HandleEvent = Data.taggedEnum<HandleEventDefinition>();

// ─── Region reducers (pure) ──────────────────────────────────────────────────

/** Data region: what value, if any, the handle holds. Stale data is kept. */
export function reduceData<T, E>(data: DataState<T>, event: HandleEvent<T, E>): DataState<T> {
  switch (event._tag) {
    case "Insert":
      return Object.freeze({ _tag: "Present", value: event.value, fetchedAt: new Date() });
    case "Reset":
      return ABSENT;
    case "Fetch":
    case "Settled":
    case "Failed":
      // Fetch/Settled/Failed never drop data — that's the stale-while-revalidate
      // guarantee (a refetch error keeps the last-known-good value).
      return data;
  }
}

/** Fetch region: what the most recent fetch is doing / how it settled. */
export function reduceFetch<T, E>(fetch: FetchState<E>, event: HandleEvent<T, E>): FetchState<E> {
  switch (event._tag) {
    case "Fetch":
      return FETCHING;
    case "Settled":
      return IDLE;
    case "Failed":
      return Object.freeze({ _tag: "Failed", error: event.error });
    case "Insert":
      // An out-of-band insert doesn't change in-flight activity.
      return fetch;
    case "Reset":
      // An in-flight fetch survives a reset and will repopulate; otherwise idle.
      return fetch._tag === "Fetching" ? fetch : IDLE;
  }
}

const ABSENT: DataState<never> = Object.freeze({ _tag: "Absent" });
const IDLE: FetchState<never> = Object.freeze({ _tag: "Idle" });
const FETCHING: FetchState<never> = Object.freeze({ _tag: "Fetching" });

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

// ─── The mutable handle the store/finder operate on ──────────────────────────

/**
 * Internal handle — the reactive object behind the public `DocumentHandle` /
 * `QueryHandle`. Carries the two regions plus the resolver functions for the
 * in-flight promise. The public type is a structural view that hides `resolve`
 * / `reject` and narrows `data` / `fetch`.
 */
export interface InternalHandle<T = unknown, E = SiloError> {
  data: DataState<T>;
  fetch: FetchState<E>;
  promise: Promise<T> | undefined;
  resolve?: (v: T) => void;
  reject?: (e: unknown) => void;
}

export function makeIdleHandle<T = unknown, E = SiloError>(): InternalHandle<T, E> {
  return { data: ABSENT, fetch: IDLE, promise: undefined, resolve: undefined, reject: undefined };
}

/**
 * Apply one event to a handle: reduce both regions, then settle the promise
 * lifecycle. Mutates the handle in place — callers wrap this in `batch(...)`
 * so the kernel coalesces the region writes into one reactive notification.
 */
export function applyEvent<T>(handle: InternalHandle<T>, event: HandleEvent<T, SiloError>): void {
  const wasPresent = handle.data._tag === "Present";
  const wasFetching = handle.fetch._tag === "Fetching";

  handle.data = reduceData(handle.data, event);
  handle.fetch = reduceFetch(handle.fetch, event);

  switch (event._tag) {
    case "Fetch": {
      if (handle.promise === undefined) {
        const r = withResolvers<T>();
        // Suppress unhandled-rejection warnings; users still observe via await.
        r.promise.catch(() => {});
        handle.promise = r.promise;
        handle.resolve = r.resolve;
        handle.reject = r.reject;
      }
      break;
    }
    case "Insert": {
      if (handle.resolve) {
        handle.resolve(event.value);
        handle.resolve = undefined;
        handle.reject = undefined;
      } else if (!wasPresent) {
        // Insert after an error/idle handle: hand out a fresh resolved promise
        // so a Suspense boundary nested in an error boundary can recover.
        handle.promise = Promise.resolve(event.value);
      }
      break;
    }
    case "Settled": {
      if (handle.resolve && handle.data._tag === "Present") {
        handle.resolve(handle.data.value);
        handle.resolve = undefined;
        handle.reject = undefined;
      }
      break;
    }
    case "Failed": {
      // Reject only a first-load failure (no data yet) with a pending resolver.
      // A refetch error after a prior success leaves the resolved promise alone.
      if (handle.reject && handle.data._tag === "Absent") {
        handle.reject(event.error);
        handle.resolve = undefined;
        handle.reject = undefined;
      }
      break;
    }
    case "Reset": {
      if (!wasFetching) {
        handle.promise = undefined;
        handle.resolve = undefined;
        handle.reject = undefined;
      }
      break;
    }
  }
}
