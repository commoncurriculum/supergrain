import { DocumentStore } from '../core/store'
import { useSignal, useComputed } from '@preact/signals-react'
import { useEffect } from 'react'

export function useDocument<T>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  const signal = useComputed(() => store.getDocument<T>(type, id))
  const value = useSignal(signal.value?.value ?? null)

  useEffect(() => {
    return signal.value?.subscribe(value => {
      // @ts-expect-error - value is a signal
      value.value = value
    })
  }, [signal])

  return value.value as T | null
}

export function useDocuments<T>(
  store: DocumentStore,
  type: string,
  ids: string[]
): (T | null)[] {
  return ids.map(id => useDocument(store, type, id))
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  throw new Error('Not implemented')
}
