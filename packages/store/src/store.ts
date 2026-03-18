import { createStore, computed, type SetStoreFunction } from "@supergrain/core";
import { DocumentPromiseImpl } from "./document-promise";
import type { StoreState, DocumentPromise, DocumentTypes, FetchHandler } from "./types";

export class Store<T extends DocumentTypes = DocumentTypes> {
  private store: StoreState;
  private update: SetStoreFunction;
  private fetchHandler?: FetchHandler;
  private promiseCache = new Map<string, DocumentPromise<any>>();

  constructor(fetchHandler?: FetchHandler) {
    const [store, update] = createStore<StoreState>({
      documents: {},
    });
    this.store = store;
    this.update = update;
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

      // Set just this document's state without copying the entire map
      this.update({
        $set: {
          [`documents.${modelTypeStr}.${key}`]: {
            content: undefined,
            status: "pending" as const,
          },
        },
      });
    }

    const documentState = computed(() => this.store.documents[modelTypeStr]?.[key]);
    const promise = new DocumentPromiseImpl<T[K]>(documentState);
    this.promiseCache.set(cacheKey, promise);

    return promise;
  }

  setDocument<K extends keyof T>(modelType: K, id: string | number, data: T[K]): void {
    const key = String(id);
    const modelTypeStr = String(modelType);

    this.update({
      $set: {
        [`documents.${modelTypeStr}.${key}`]: {
          content: data,
          status: "fulfilled" as const,
          lastFetched: Date.now(),
        },
      },
    });
  }

  setDocumentError<K extends keyof T>(modelType: K, id: string | number, error: string): void {
    const key = String(id);
    const modelTypeStr = String(modelType);

    this.update({
      $set: {
        [`documents.${modelTypeStr}.${key}`]: {
          content: undefined,
          status: "rejected" as const,
          error,
        },
      },
    });
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
