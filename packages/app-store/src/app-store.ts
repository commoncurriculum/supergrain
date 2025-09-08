import { createStore, computed, type SetStoreFunction } from '@storable/core'
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

    const documentState = computed(() => {
      return this.store.documents[modelTypeStr]?.[key]
    })

    if (!documentState()) {
      this.triggerFetch(modelTypeStr, id)

      this.update({
        $set: {
          [`documents.${modelTypeStr}.${key}`]: {
            content: undefined,
            status: 'pending' as const,
          },
        },
      })
    }

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

  insertDocument<K extends keyof T>(
    modelType: K,
    data: Partial<T[K]> & { id: string | number }
  ): Promise<T[K]> {
    return new Promise((resolve, reject) => {
      const id = data.id
      const key = String(id)
      const modelTypeStr = String(modelType)

      // Set as pending first
      this.update({
        $set: {
          [`documents.${modelTypeStr}.${key}`]: {
            content: undefined,
            status: 'pending' as const,
          },
        },
      })

      // Simulate async insertion
      setTimeout(() => {
        try {
          // In a real implementation, this would call an API
          const insertedData = { ...data } as T[K]
          this.setDocument(modelType, id, insertedData)
          resolve(insertedData)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          this.setDocumentError(modelType, id, errorMessage)
          reject(error)
        }
      }, 0)
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
