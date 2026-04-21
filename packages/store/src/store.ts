import type { StoreState, DocumentPromise, DocumentTypes, FetchHandler } from "./types";

import { createReactive, computed } from "@supergrain/core";

import { DocumentPromiseImpl } from "./document-promise";

export class Store<T extends DocumentTypes = DocumentTypes> {
  private store: StoreState;
  private fetchHandler?: FetchHandler;
  private promiseCache = new Map<string, DocumentPromise<any>>();

  constructor(fetchHandler?: FetchHandler) {
    this.store = createReactive<StoreState>({
      documents: {},
    });
    this.fetchHandler = fetchHandler;
  }

  findDoc<K extends keyof T>(modelType: K, id: string | number): DocumentPromise<T[K]> {
    const key = String(id);
    const modelTypeStr = String(modelType);
    const cacheKey = `${modelTypeStr}:${key}`;

    // Return cached promise if it exists
    const cached = this.promiseCache.get(cacheKey);
    if (cached) {
      return cached as DocumentPromise<T[K]>;
    }

    // Check if document already exists in the store
    const existingDoc = this.store.documents[modelTypeStr]?.[key];

    if (!existingDoc) {
      this.triggerFetch(modelTypeStr, id);

      // Set just this document's state without copying the entire map.
      // Direct mutation against the reactive proxy fires the same signals that
      // `update({ $set: ... })` would, without needing a dynamic-key path string.
      this.store.documents[modelTypeStr] ??= {};
      this.store.documents[modelTypeStr][key] = {
        content: undefined,
        status: "pending",
      };
    }

    const documentState = computed(() => this.store.documents[modelTypeStr]?.[key]);
    const promise = new DocumentPromiseImpl<T[K]>(documentState);
    this.promiseCache.set(cacheKey, promise);

    return promise;
  }

  setDocument<K extends keyof T>(modelType: K, id: string | number, data: T[K]): void {
    const key = String(id);
    const modelTypeStr = String(modelType);

    this.store.documents[modelTypeStr] ??= {};
    this.store.documents[modelTypeStr][key] = {
      content: data,
      status: "fulfilled",
      lastFetched: Date.now(),
    };
  }

  setDocumentError<K extends keyof T>(modelType: K, id: string | number, error: string): void {
    const key = String(id);
    const modelTypeStr = String(modelType);

    this.store.documents[modelTypeStr] ??= {};
    this.store.documents[modelTypeStr][key] = {
      content: undefined,
      status: "rejected",
      error,
    };
  }

  private async triggerFetch(modelType: string, id: string | number): Promise<void> {
    if (!this.fetchHandler) {
      return;
    }

    try {
      const data = await this.fetchHandler(modelType, id);
      this.setDocument(modelType as keyof T, id, data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.setDocumentError(modelType as keyof T, id, errorMessage);
    }
  }
}
