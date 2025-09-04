import { useSyncExternalStore } from 'react'

import { DocumentStore } from '../core/store'
import type { Document } from '../core/types'

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  // The subscribe function must be stable and not re-created on every render.
  // It registers the component's callback with the store for a specific document.
  const subscribe = (callback: () => void) => {
    return store.subscribe(type, id, callback)
  }

  // The getSnapshot function should return a cached or immutable version of the data.
  // This function is called by React to get the current state.
  const getSnapshot = () => {
    return store.getDocumentSnapshot<T>(type, id)
  }

  // useSyncExternalStore handles the subscription and re-rendering logic.
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function useDocuments<T extends Document>(
  store: DocumentStore,
  type: string,
  ids: string[]
): (T | null)[] {
  // Subscribe to all documents and return a single unsubscribe function.
  const subscribe = (callback: () => void) => {
    const unsubscribers = ids.map(id => store.subscribe(type, id, callback))
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe())
    }
  }

  // Get snapshots for all requested documents.
  const getSnapshot = () => {
    return ids.map(id => store.getDocumentSnapshot<T>(type, id))
  }

  return useSyncExternalStore(subscribe, getSnapshot)
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
