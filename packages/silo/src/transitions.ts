import type { SiloError } from "./errors";
import type { HandleStatus } from "./store";
import type { Data } from "effect";

import { reconcile, unwrap } from "@supergrain/kernel";

export type HandleEvent<T = unknown, E = SiloError> = Data.TaggedEnum<{
  Fetch: Record<never, never>;
  Insert: { readonly value: T; readonly onRefetch: "patch" | "replace" };
  Settled: { readonly generation: number };
  Retrying: { readonly error: E; readonly generation: number };
  Failed: { readonly error: E; readonly generation: number };
  Aborted: { readonly generation?: number };
  Reset: Record<never, never>;
}>;

// `generation` is required on Settled/Retrying/Failed so no emitter can bypass
// the stale-cycle fence in `applyEvent`.
export const HandleEvent = {
  fetch: (): HandleEvent => ({ _tag: "Fetch" }),
  insert: <T>(value: T, onRefetch: "patch" | "replace" = "patch"): HandleEvent<T> => ({
    _tag: "Insert",
    value,
    onRefetch,
  }),
  settled: (generation: number): HandleEvent => ({ _tag: "Settled", generation }),
  retrying: (error: SiloError, generation: number): HandleEvent => ({
    _tag: "Retrying",
    error,
    generation,
  }),
  failed: (error: SiloError, generation: number): HandleEvent => ({
    _tag: "Failed",
    error,
    generation,
  }),
  aborted: (generation?: number): HandleEvent => ({ _tag: "Aborted", generation }),
  reset: (): HandleEvent => ({ _tag: "Reset" }),
};

function deriveStatus(value: unknown, error: unknown): HandleStatus {
  if (value !== undefined) return "success";
  if (error !== undefined) return "error";
  return "pending";
}

export interface InternalHandle<T = unknown, E = SiloError> {
  value: T | undefined;
  error: E | undefined;
  isFetching: boolean;
  fetchedAt: Date | undefined;
  failureCount: number;
  lastError: E | undefined;
  status: HandleStatus;
  promise: Promise<T> | undefined;
  /** Read and written untracked, via the raw target. */
  generation: number;
  resolve?: (v: T) => void;
  reject?: (e: unknown) => void;
}

export function makeIdleHandle<T = unknown, E = SiloError>(): InternalHandle<T, E> {
  return {
    value: undefined,
    error: undefined,
    isFetching: false,
    fetchedAt: undefined,
    failureCount: 0,
    lastError: undefined,
    status: "pending",
    promise: undefined,
    generation: 0,
    resolve: undefined,
    reject: undefined,
  };
}

export interface Resolvers<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function clearResolvers<T>(handle: InternalHandle<T>): void {
  handle.resolve = undefined;
  handle.reject = undefined;
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
  // Avoids the browser's unhandled-rejection warning; awaiters still see it.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * Reads go through the raw target: reading the proxy would subscribe a tracked
 * caller (e.g. `insertDocument` during render) to the fields it writes, a
 * self-triggering loop. Only changed fields are written, to keep per-field
 * reactivity.
 */
export function applyEvent<T>(handle: InternalHandle<T>, event: HandleEvent<T, SiloError>): void {
  const raw = unwrap(handle);
  const hadValue = raw.value !== undefined;
  const wasFetching = raw.isFetching;

  // Inserting `undefined` would resolve the pending promise and leave a later
  // `Failed` (e.g. NotFoundError) unable to reject it.
  if (event._tag === "Insert" && event.value === undefined) return;

  if (
    "generation" in event &&
    event.generation !== undefined &&
    event.generation !== raw.generation
  ) {
    return;
  }

  let { value, error, isFetching, fetchedAt, failureCount, lastError } = raw;

  switch (event._tag) {
    case "Fetch": {
      raw.generation += 1;
      isFetching = true;
      failureCount = 0;
      lastError = undefined;
      break;
    }
    case "Insert": {
      value = event.onRefetch === "replace" ? event.value : reconcile(value, event.value);
      // A local insert into a loaded idle handle (e.g. a websocket push) keeps
      // `fetchedAt`, so TTL checks still measure the last fetch.
      if (wasFetching || !hadValue) fetchedAt = new Date();
      error = undefined;
      failureCount = 0;
      lastError = undefined;
      break;
    }
    case "Settled": {
      isFetching = false;
      error = undefined;
      failureCount = 0;
      lastError = undefined;
      break;
    }
    case "Retrying": {
      lastError = event.error;
      failureCount += 1;
      break;
    }
    case "Failed": {
      ({ error } = event);
      lastError = event.error;
      isFetching = false;
      break;
    }
    case "Aborted": {
      isFetching = false;
      break;
    }
    case "Reset": {
      value = undefined;
      error = undefined;
      fetchedAt = undefined;
      failureCount = 0;
      lastError = undefined;
      // isFetching is left alone: an in-flight fetch survives a reset.
      break;
    }
    /* c8 ignore next 3 -- compile-time exhaustiveness guard; unreachable */
    default: {
      event satisfies never;
    }
  }

  const status = deriveStatus(value, error);

  if (raw.value !== value) handle.value = value;
  if (raw.error !== error) handle.error = error;
  if (raw.isFetching !== isFetching) handle.isFetching = isFetching;
  if (raw.fetchedAt !== fetchedAt) handle.fetchedAt = fetchedAt;
  if (raw.failureCount !== failureCount) handle.failureCount = failureCount;
  if (raw.lastError !== lastError) handle.lastError = lastError;
  if (raw.status !== status) handle.status = status;

  switch (event._tag) {
    case "Fetch": {
      if (raw.promise === undefined) {
        const r = withResolvers<T>();
        handle.promise = r.promise;
        raw.resolve = r.resolve;
        raw.reject = r.reject;
      }
      break;
    }
    case "Insert": {
      if (raw.resolve) {
        raw.resolve(event.value);
        clearResolvers(raw);
      } else if (!hadValue) {
        // A fresh promise lets a Suspense boundary inside an error boundary recover.
        handle.promise = Promise.resolve(event.value);
      }
      break;
    }
    case "Settled": {
      if (raw.resolve && raw.value !== undefined) {
        raw.resolve(raw.value);
        clearResolvers(raw);
      }
      break;
    }
    case "Retrying": {
      break;
    }
    case "Failed": {
      if (raw.reject && raw.value === undefined) {
        raw.reject(event.error);
        clearResolvers(raw);
      }
      break;
    }
    case "Aborted": {
      break;
    }
    case "Reset": {
      if (!wasFetching) {
        handle.promise = undefined;
        clearResolvers(raw);
      }
      break;
    }
    /* c8 ignore next 3 -- compile-time exhaustiveness guard; unreachable */
    default: {
      event satisfies never;
    }
  }
}
