import { DocumentStore } from '../core/store'
import { onUnmounted, ref } from 'vue'
import { effect } from 'alien-deepsignals'
import type { Ref } from 'vue'
import type { Document } from '../core/types'

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): Ref<T | null> {
  // Create a Vue ref that will hold the document value
  const documentRef = ref(null as T | null)

  // Get the deep signal directly from store
  const deepSignal = store.getDeepSignal(type, id)

  // Use alien-signals effect to track changes
  const effectObj = effect(() => {
    const currentValue = deepSignal._isEmpty ? null : deepSignal
    documentRef.value = currentValue
  })

  // Clean up effect when component unmounts
  onUnmounted(() => {
    effectObj.stop()
  })

  return documentRef as Ref<T | null>
}

export function useDocuments<T extends Document>(
  store: DocumentStore,
  type: string,
  ids: string[]
): Ref<(T | null)[]> {
  // Create a Vue ref that will hold the array of documents
  const documentsRef = ref([] as (T | null)[])

  // Get all deep signals directly
  const deepSignals = ids.map(id => store.getDeepSignal(type, id))

  // Use alien-signals effect to track changes to any document
  const effectObj = effect(() => {
    const currentDocs = deepSignals.map(sig => (sig._isEmpty ? null : sig))
    documentsRef.value = currentDocs
  })

  // Clean up effect when component unmounts
  onUnmounted(() => {
    effectObj.stop()
  })

  return documentsRef as Ref<(T | null)[]>
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
