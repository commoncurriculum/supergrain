import { DocumentStore } from '../core/store'
import { onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { Document } from '../core/types'

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): Ref<T | null> {
  // Use a Vue ref to hold the reactive document state.
  const documentRef = ref(
    store.getDocumentSnapshot<T>(type, id)
  ) as Ref<T | null>

  // Subscribe to changes in the document.
  const unsubscribe = store.subscribe(type, id, () => {
    // When the document changes, update the ref with a new snapshot.
    documentRef.value = store.getDocumentSnapshot<T>(type, id)
  })

  // Clean up the subscription when the component unmounts.
  onUnmounted(() => {
    unsubscribe()
  })

  return documentRef
}

export function useDocuments<T extends Document>(
  store: DocumentStore,
  type: string,
  ids: string[]
): Ref<(T | null)[]> {
  // Use a Vue ref to hold the reactive array of documents.
  const getSnapshots = () =>
    ids.map(id => store.getDocumentSnapshot<T>(type, id))
  const documentsRef = ref(getSnapshots()) as Ref<(T | null)[]>

  // Subscribe to all documents.
  const unsubscribers = ids.map(id =>
    store.subscribe(type, id, () => {
      // When any document changes, update the ref with new snapshots for all documents.
      documentsRef.value = getSnapshots()
    })
  )

  // Clean up all subscriptions when the component unmounts.
  onUnmounted(() => {
    unsubscribers.forEach(unsubscribe => unsubscribe())
  })

  return documentsRef
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
