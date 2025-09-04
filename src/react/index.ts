import { useEffect, useState, useMemo } from 'react'
import { effect } from 'alien-deepsignals'
import { DocumentStore } from '../core/store'
import type { Document } from '../core/types'

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  // Get the deep signal directly from store
  const deepSignal = useMemo(() => {
    return store.getDeepSignal(type, id)
  }, [store, type, id])

  // Use useState for the current value
  const [value, setValue] = useState<T | null>(() =>
    deepSignal._isEmpty ? null : deepSignal
  )

  useEffect(() => {
    // Use alien-signals effect to track changes
    const effectObj = effect(() => {
      const currentValue = deepSignal._isEmpty ? null : deepSignal
      setValue(currentValue)
    })

    return () => effectObj.stop()
  }, [deepSignal])

  return value
}

export function useDocuments<T extends Document>(
  store: DocumentStore,
  type: string,
  ids: string[]
): (T | null)[] {
  // Create stable reference for ids array
  const stableIds = useMemo(() => ids, [JSON.stringify(ids)])

  // Get all deep signals directly
  const deepSignals = useMemo(() => {
    return stableIds.map(id => store.getDeepSignal(type, id))
  }, [store, type, stableIds])

  // Use useState for the current documents array
  const [documents, setDocuments] = useState<(T | null)[]>(() => {
    return deepSignals.map(sig => (sig._isEmpty ? null : sig))
  })

  useEffect(() => {
    // Use alien-signals effect to track changes to any document
    const effectObj = effect(() => {
      const currentDocs = deepSignals.map(sig => (sig._isEmpty ? null : sig))
      setDocuments(currentDocs)
    })

    return () => effectObj.stop()
  }, [deepSignals])

  return documents
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
