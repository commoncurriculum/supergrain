import { createStore, computed, type SetStoreFunction } from '@supergrain/core'
import { DocumentPromiseImpl } from './document-promise'
import type {
  AppStoreState,
  DocumentPromise,
  DocumentTypes,
  FetchHandler
} from './types'

export class AppStore<T extends DocumentTypes = DocumentTypes> {
  private store: AppStoreState
  private update: SetStoreFunction
  private fetchHandler?: FetchHandler

  constructor(fetchHandler?: FetchHandler) {
    const [store, update] = createStore<AppStoreState>({
      documents: {},
    })
    this.store = store
    this.update = update
    this.fetchHandler = fetchHandler
  }

  findDoc<K extends keyof T>(
    modelType: K,
    id: string | number
  ): DocumentPromise<T[K]> {
    const key = String(id)
    const modelTypeStr = String(modelType)

    // Check if document already exists
    const existingDoc = this.store.documents[modelTypeStr]?.[key]

    if (!existingDoc) {
      this.triggerFetch(modelTypeStr, id)

      // Ensure the nested path exists before setting the document
      this.update({
        $set: {
          [`documents.${modelTypeStr}`]: {
            ...this.store.documents[modelTypeStr],
            [key]: {
              content: undefined,
              status: 'pending' as const,
            },
          },
        },
      })
    }

    const documentState = computed(() => {
      return this.store.documents[modelTypeStr]?.[key]
    })

    return new DocumentPromiseImpl(documentState)
  }

  setDocument<K extends keyof T>(
    modelType: K,
    id: string | number,
    data: T[K]
  ): void {
    const key = String(id)
    const modelTypeStr = String(modelType)

    this.update({
      $set: {
        [`documents.${modelTypeStr}.${key}`]: {
          content: data,
          status: 'fulfilled' as const,
          lastFetched: Date.now(),
        },
      },
    })
  }

  setDocumentError<K extends keyof T>(
    modelType: K,
    id: string | number,
    error: string
  ): void {
    const key = String(id)
    const modelTypeStr = String(modelType)

    this.update({
      $set: {
        [`documents.${modelTypeStr}.${key}`]: {
          content: undefined,
          status: 'rejected' as const,
          error,
        },
      },
    })
  }

  private async triggerFetch(modelType: string, id: string | number): Promise<void> {
    if (!this.fetchHandler) {
      return
    }

    try {
      const data = await this.fetchHandler(modelType, id)
      this.setDocument(modelType as keyof T, id, data)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.setDocumentError(modelType as keyof T, id, errorMessage)
    }
  }
}
