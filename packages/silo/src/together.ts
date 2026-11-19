import type { SiloError } from "./errors";
import type { DocumentHandle, HandlePromise } from "./store";

import { computed, stableComputed } from "@supergrain/kernel";

/**
 * All-or-nothing handle for a batch of documents of one type, returned by
 * `findDocumentsTogether` / `useDocumentsTogether`. `pending` until every
 * document has loaded, then `success` with `value` in id order; `error` as
 * soon as any fails (like `Promise.all`). For independent per-document handles
 * use `findDocumentsIndividually` / `useDocumentsIndividually`.
 *
 * Narrowing on `status` refines `value`. Each field is reactive on its own.
 *
 * `promise` (for React's `use()`) is `undefined` while any handle is idle
 * (`null` ids, or after `clearMemory`); it resolves with all documents and
 * rejects as soon as one fails.
 */
export type DocumentsTogetherHandle<T, E = SiloError> =
  | {
      /** Some document has no value yet and none failed. Idle handles count as pending. */
      readonly status: "pending";
      readonly value: undefined;
      readonly error: undefined;
      readonly isFetching: boolean;
      readonly promise: HandlePromise<Array<T>>;
    }
  | {
      readonly status: "success";
      readonly value: Array<T>;
      readonly error: undefined;
      readonly isFetching: boolean;
      readonly promise: HandlePromise<Array<T>>;
    }
  | {
      readonly status: "error";
      readonly value: undefined;
      /** The first failing document's error. */
      readonly error: E;
      readonly isFetching: boolean;
      readonly promise: HandlePromise<Array<T>>;
    };

class DocumentsTogetherHandleImpl<T, E = SiloError> {
  constructor(readonly handles: Array<DocumentHandle<T, E>>) {}

  private readonly _status = computed((): "pending" | "success" | "error" => {
    // Uses `status`, not `error`: a success whose refetch errored stays success,
    // matching `promise`, which already resolved for it.
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

  // Must keep a stable identity until a handle's promise changes, or React's
  // `use()` re-suspends every render.
  private readonly _promise = computed<HandlePromise<Array<T>>>(() => {
    // Padding an idle handle with a placeholder would resolve with `undefined` holes.
    const inputs: Array<Promise<T>> = [];
    for (const handle of this.handles) {
      if (handle.promise === undefined) return;
      inputs.push(handle.promise);
    }
    const promise = Promise.all(inputs).then(() => this.handles.map((handle) => handle.value as T));
    // Avoids the browser's unhandled-rejection warning; awaiters still see it.
    promise.catch(() => {});
    return promise;
  });
  get promise(): HandlePromise<Array<T>> {
    return this._promise();
  }
}

export const IDLE_DOCUMENTS_TOGETHER_HANDLE: DocumentsTogetherHandle<never> = Object.freeze({
  status: "pending" as const,
  value: undefined,
  error: undefined,
  isFetching: false,
  promise: undefined,
});

export function combineDocumentsTogether<T, E = SiloError>(
  handles: Array<DocumentHandle<T, E>>,
): DocumentsTogetherHandle<T, E> {
  return new DocumentsTogetherHandleImpl(handles) as unknown as DocumentsTogetherHandle<T, E>;
}
