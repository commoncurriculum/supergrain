import { DocumentStore } from '../core/store'
import { onUnmounted, ref, watch, unref } from 'vue'
import type { Ref } from 'vue'
import type { Document } from '../core/types'

interface DocumentSignal<T> {
  value: T | null
  subscribe: (callback: (value: T | null) => void) => () => void
}

export function useDocument<T extends Document>(
  store: DocumentStore,
  type: string,
  id: string
): Ref<T | null> {
  // Create a Vue ref that will hold the document value
  const documentRef = ref<T | null>(null as T | null)

  // Get the signal from store
  const signal: DocumentSignal<T> = store.getDocumentSignal<T>(type, id)

  // Set initial value
  documentRef.value = signal.value

  // Subscribe to signal changes
  const unsubscribe = signal.subscribe((newValue: T | null) => {
    documentRef.value = newValue
  })

  // Clean up subscription when component unmounts
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
  // Create a Vue ref that will hold the array of documents
  const documentsRef = ref<(T | null)[]>([] as (T | null)[])

  // Track current subscriptions
  let currentUnsubscribes: (() => void)[] = []

  const updateSubscriptions = (newIds: string[]) => {
    // Clean up previous subscriptions
    currentUnsubscribes.forEach(unsub => unsub())
    currentUnsubscribes = []

    // Get all signals and initial values
    const signals = newIds.map(id => store.getDocumentSignal<T>(type, id))
    const initialValues = signals.map(signal => signal.value)
    documentsRef.value = initialValues

    // Set up new subscriptions
    signals.forEach((signal, index) => {
      const unsubscribe = signal.subscribe((newValue: T | null) => {
        const newDocs = [...documentsRef.value]
        newDocs[index] = newValue as T | null
        documentsRef.value = newDocs
      })
      currentUnsubscribes.push(unsubscribe)
    })
  }

  // Set up initial subscriptions
  updateSubscriptions(unref(ids))

  // Watch for changes to ids array and update subscriptions
  // Use unref to handle both reactive and non-reactive values
  watch(
    () => unref(ids),
    newIds => {
      updateSubscriptions(newIds)
    },
    { deep: true, immediate: false }
  )

  // Clean up all subscriptions when component unmounts
  onUnmounted(() => {
    currentUnsubscribes.forEach(unsub => unsub())
  })

  return documentsRef
}

export function useDocumentStore(store: DocumentStore): DocumentStore {
  return store
}
