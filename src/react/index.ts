import { useSyncExternalStore } from 'react'
import { watch } from 'alien-deepsignals'
import { DocumentStore } from '../core/store'
import type { Document } from '../core/types'

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  return useSyncExternalStore(
    callback => {
      // Subscribe function - set up watch and return unsubscribe
      const deepSignal = store.getDeepSignal(type, id)

      try {
        const unwatch = watch(
          deepSignal,
          () => {
            // Notify React of changes
            callback()
          },
          {
            deep: true,
          }
        )
        return unwatch
      } catch (error) {
        console.error('Failed to watch deep signal:', error)
        // Return a no-op unsubscribe function if watch fails
        return () => {}
      }
    },
    () => {
      // Get current value function
      const deepSignal = store.getDeepSignal(type, id)
      return deepSignal._isEmpty ? null : (deepSignal as T)
    }
  )
}

export function useDocuments<T extends Document>(
  store: DocumentStore,
  type: string,
  ids: string[]
): (T | null)[] {
  return useSyncExternalStore(
    callback => {
      // Subscribe function - set up watches for all documents
      const unwatchers = ids.map(id => {
        try {
          const deepSignal = store.getDeepSignal(type, id)
          return watch(
            deepSignal,
            () => {
              callback()
            },
            {
              deep: true,
            }
          )
        } catch (error) {
          console.error('Failed to watch deep signal for id', id, error)
          return () => {}
        }
      })

      return () => {
        unwatchers.forEach(unwatch => unwatch())
      }
    },
    () => {
      // Get current value function
      return ids.map(id => {
        const deepSignal = store.getDeepSignal(type, id)
        return deepSignal._isEmpty ? null : (deepSignal as T)
      })
    }
  )
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
