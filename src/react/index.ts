import { useSyncExternalStore, useMemo } from 'react'
import { DocumentStore } from '../core/store'
import type { Document } from '../core/types'

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  // Get the document signal from store - use useMemo to ensure this only happens once per key
  const signal = useMemo(() => {
    return store.getDocumentSignal<T>(type, id)
  }, [store, type, id])

  // Use useSyncExternalStore to properly subscribe to the document signal
  const value = useSyncExternalStore(
    // Subscribe function
    (callback: () => void) => {
      return signal.subscribe(callback)
    },
    // Get snapshot function
    () => {
      return signal.value
    },
    // Get server snapshot function (for SSR)
    () => {
      return signal.value
    }
  )

  return value
}

export function useDocuments<T extends Document>(
  store: DocumentStore,
  type: string,
  ids: string[]
): (T | null)[] {
  // Get all signals - use useMemo to ensure stable references
  const signals = useMemo(() => {
    return ids.map(id => store.getDocumentSignal<T>(type, id))
  }, [store, type, ids])

  // Use useSyncExternalStore to subscribe to all signals
  const documents = useSyncExternalStore(
    // Subscribe function
    (callback: () => void) => {
      const unsubscribes = signals.map(signal => signal.subscribe(callback))

      // Return unsubscribe function
      return () => {
        unsubscribes.forEach(unsub => unsub())
      }
    },
    // Get snapshot function
    () => {
      return signals.map(signal => signal.value)
    },
    // Get server snapshot function (for SSR)
    () => {
      return signals.map(signal => signal.value)
    }
  )

  return documents
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
