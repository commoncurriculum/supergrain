import { DocumentStore } from '../core/store'
import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useRef, useState } from 'react'
import type { Signal } from '@preact/signals-core'

export function useDocument<T>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  useSignals()

  // Get the signal from store
  const signalRef = useRef<Signal<T | null>>()
  const [value, setValue] = useState<T | null>(null)

  if (!signalRef.current) {
    signalRef.current = store.getDocumentSignal<T>(type, id)
    setValue(signalRef.current.value)
  }

  // Subscribe to signal changes and track the subscription
  useEffect(() => {
    const signal = signalRef.current!
    setValue(signal.value) // Set initial value

    // Create explicit subscription that will be tracked by DocumentStore
    const unsubscribe = signal.subscribe((newValue: T | null) => {
      setValue(newValue)
    })

    return unsubscribe
  }, [type, id, store])

  return value
}

export function useDocuments<T>(
  store: DocumentStore,
  type: string,
  ids: string[]
): (T | null)[] {
  useSignals()

  const [documents, setDocuments] = useState<(T | null)[]>([])
  const idsStringRef = useRef<string>('')

  // Track subscriptions
  const subscriptionsRef = useRef<(() => void)[]>([])

  useEffect(() => {
    const idsString = JSON.stringify(ids)

    // Only update if IDs actually changed
    if (idsStringRef.current !== idsString) {
      idsStringRef.current = idsString

      // Clean up previous subscriptions
      subscriptionsRef.current.forEach(unsub => unsub())
      subscriptionsRef.current = []

      // Get all signals and initial values
      const signals = ids.map(id => store.getDocumentSignal<T>(type, id))
      const initialValues = signals.map(signal => signal.value)
      setDocuments(initialValues)

      // Set up new subscriptions
      signals.forEach((signal, index) => {
        const unsubscribe = signal.subscribe((newValue: T | null) => {
          setDocuments(prevDocs => {
            const newDocs = [...prevDocs]
            newDocs[index] = newValue
            return newDocs
          })
        })
        subscriptionsRef.current.push(unsubscribe)
      })
    }
  }, [ids, type, store])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach(unsub => unsub())
    }
  }, [])

  return documents
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
