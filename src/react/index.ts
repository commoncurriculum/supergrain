import { useEffect, useState, useMemo } from 'react'
import { DocumentStore } from '../core/store'
import type { Document } from '../core/types'

interface DocumentSignal<T> {
  value: T | null
  subscribe: (callback: (value: T | null) => void) => () => void
}

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  // Get the signal from store - use useMemo to ensure this only happens once per key
  const signal = useMemo(() => {
    return store.getDocumentSignal<T>(type, id)
  }, [store, type, id])

  const [value, setValue] = useState<T | null>(() => signal.value)

  // Subscribe to signal changes
  useEffect(() => {
    // Set initial value in case it changed
    setValue(signal.value)

    // Create explicit subscription that will be tracked by DocumentStore
    const unsubscribe = signal.subscribe((newValue: T | null) => {
      setValue(newValue)
    })

    return unsubscribe
  }, [signal])

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

  // Initialize state with current signal values
  const [documents, setDocuments] = useState<(T | null)[]>(() => {
    return signals.map((signal: DocumentSignal<T>) => signal.value)
  })

  // Subscribe to all signals
  useEffect(() => {
    // Update with current values
    setDocuments(signals.map((signal: DocumentSignal<T>) => signal.value))

    // Set up subscriptions
    const unsubscribes = signals.map(
      (signal: DocumentSignal<T>, index: number) => {
        return signal.subscribe((newValue: T | null) => {
          setDocuments((prevDocs: (T | null)[]) => {
            const newDocs = [...prevDocs]
            newDocs[index] = newValue
            return newDocs
          })
        })
      }
    )

    // Cleanup function
    return () => {
      unsubscribes.forEach((unsub: () => void) => unsub())
    }
  }, [signals])

  return documents
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
