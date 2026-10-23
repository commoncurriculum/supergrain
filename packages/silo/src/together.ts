import type { SiloError } from "./errors";
import type { DocumentHandle, HandlePromise } from "./store";

import { computed, stableComputed } from "@supergrain/kernel";

// =============================================================================
// DocumentsTogetherHandle — the all-or-nothing view over a batch of documents.
// A derived, read-only aggregation of per-id `DocumentHandle`s; the store's
// fetch machinery never touches this module.
// =============================================================================

/**
 * All-or-nothing handle for a batch of documents of one type, queried by id —
 * what `findDocumentsTogether` / `useDocumentsTogether` return. It settles as a
 * unit: `pending` until every requested document has loaded, `success` (with
 * `value` = all documents in id order) once they all have, `error` if any of
 * them failed (terminal, like `Promise.all`).
 *
 * For the per-document view — one independent handle each, settling on its own —
 * use `findDocumentsIndividually` / `useDocumentsIndividually` instead.
 *
 * A `status`-discriminated union (like {@link DocumentHandle}): narrowing on
 * `status` refines `value` — `"success"` gives `value: T[]`, the others give
 * `value: undefined`. `isFetching` and `promise` are orthogonal and present on
 * every arm. Reactive via getters (kernel `computed`s) over the underlying
 * handles, so reading a field subscribes the caller to just that derived value;
 * a handle change that leaves the field unchanged doesn't re-fire (e.g. one of
 * three pending handles resolving keeps `status` `"pending"`). Not stable across
 * `findDocumentsTogether` calls on its own — `useDocumentsTogether` layers
 * render-stability on top.
 *
 * `promise` is the combined promise for React 19's `use()`: present once
 * **every** handle carries its own first-load promise (created when its fetch
 * starts, or by an `insertDocument`) — while any handle is idle (`null` ids,
 * or after `clearMemory`) it stays `undefined`, because there is nothing an
 * idle slot could resolve with. It resolves with all documents once they've
 * all loaded (immediately, with `[]`, for an empty batch) and rejects as soon
 * as one fails.
 */
export type DocumentsTogetherHandle<T, E = SiloError> =
  | {
      /**
       * Some document has no value yet; none has failed. Not necessarily
       * fetching — an idle handle (e.g. after `clearMemory`) is pending too.
       */
      readonly status: "pending";
      readonly value: undefined;
      readonly error: undefined;
      readonly isFetching: boolean;
      readonly promise: HandlePromise<Array<T>>;
    }
  | {
      /** Every document loaded — `value` holds them all, in id order. */
      readonly status: "success";
      readonly value: Array<T>;
      readonly error: undefined;
      readonly isFetching: boolean;
      readonly promise: HandlePromise<Array<T>>;
    }
  | {
      /** At least one document failed (terminal, like `Promise.all`). */
      readonly status: "error";
      readonly value: undefined;
      /** The first failing document's error. */
      readonly error: E;
      readonly isFetching: boolean;
      readonly promise: HandlePromise<Array<T>>;
    };

class DocumentsTogetherHandleImpl<T, E = SiloError> {
  constructor(readonly handles: Array<DocumentHandle<T, E>>) {}

  // Each field is a kernel `computed` over the underlying handles: reading one
  // subscribes the caller to just that derived value, and the `!==` cut-off
  // suppresses re-fires when a handle change doesn't change the field. Lazy:
  // nothing runs until a field is read.

  private readonly _status = computed((): "pending" | "success" | "error" => {
    // Promise.all semantics: an error is terminal (wins over pending, which
    // wins over success). Reading `handle.status` (not `handle.error`) means a
    // stale success whose refetch errored still counts as success — its
    // first-load promise already resolved, so `promise` won't reject on it.
    let hasPending = false;
    for (const handle of this.handles) {
      if (handle.status === "error") return "error";
      if (handle.status === "pending") hasPending = true;
    }
    return hasPending ? "pending" : "success";
  });
  get status(): "pending" | "success" | "error" {
    return this._status();
  }

  // All documents in id order, as a stable reactive array reconciled in place
  // (`stableComputed`) — read only when `status === "success"`, at which point
  // every handle carries a value.
  private readonly _value = stableComputed(
    (): Array<T> => this.handles.map((handle) => handle.value as T),
  );
  get value(): Array<T> | undefined {
    return this._status() === "success" ? this._value() : undefined;
  }

  private readonly _error = computed<E | undefined>(() => {
    for (const handle of this.handles) {
      if (handle.status === "error") return handle.error;
    }
    return;
  });
  get error(): E | undefined {
    return this._error();
  }

  private readonly _isFetching = computed(() => this.handles.some((handle) => handle.isFetching));
  get isFetching(): boolean {
    return this._isFetching();
  }

  // Combined over the underlying `handle.promise` references, so a
  // refetch/insert that swaps a handle's promise rebuilds it — otherwise the
  // cached identity is returned and `use()` doesn't re-suspend every render.
  private readonly _promise = computed<HandlePromise<Array<T>>>(() => {
    // The batch has a combined promise only once EVERY handle has one. An idle
    // handle (no fetch started — e.g. after `clearMemory`) contributes no
    // value, and padding it with a resolved placeholder would fulfil the
    // combined `Promise<Array<T>>` with `undefined` holes. An empty batch has
    // no idle slots, so it resolves immediately with `[]`.
    const inputs: Array<Promise<T>> = [];
    for (const handle of this.handles) {
      if (handle.promise === undefined) return;
      inputs.push(handle.promise);
    }
    // Promise.all rejects as soon as any handle errors (even while others are
    // pending); once it fulfils every handle is a success, so snapshot them all.
    const promise = Promise.all(inputs).then(() => this.handles.map((handle) => handle.value as T));
    // Suppress unhandled-rejection warnings at the source; consumers still
    // observe the rejection by awaiting the promise (or via `use()`).
    promise.catch(() => {});
    return promise;
  });
  get promise(): HandlePromise<Array<T>> {
    return this._promise();
  }
}

/**
 * The handle for a batch nobody asked for yet (`null` / `undefined` ids): no
 * fetch has started, so it reads as pending-but-not-fetching with no promise.
 * Typed over `never` so it is assignable to `DocumentsTogetherHandle<T>` for
 * every `T` without a cast (the readonly fields are covariant).
 */
export const IDLE_DOCUMENTS_TOGETHER_HANDLE: DocumentsTogetherHandle<never> = Object.freeze({
  status: "pending" as const,
  value: undefined,
  error: undefined,
  isFetching: false,
  promise: undefined,
});

/**
 * Wrap already-fetched handles into a {@link DocumentsTogetherHandle} — the
 * shared core of `findDocumentsTogether` and `useDocumentsTogether`, so neither
 * re-fetches just to build the wrapper. Empty `handles` are immediately
 * `success` with `value: []`; for the no-ids case return
 * {@link IDLE_DOCUMENTS_TOGETHER_HANDLE} instead of calling this. The cast
 * mirrors {@link DocumentHandle}: the impl's getters realize one union arm at
 * runtime (`status === "success"` ⟺ `value` is the array).
 */
export function combineDocumentsTogether<T, E = SiloError>(
  handles: Array<DocumentHandle<T, E>>,
): DocumentsTogetherHandle<T, E> {
  return new DocumentsTogetherHandleImpl(handles) as unknown as DocumentsTogetherHandle<T, E>;
}
