import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'
import { deepSignal } from 'alien-deepsignals'

type PatchOperation = '$set' | '$unset' | '$push' | '$pull'

export interface Patch {
  op: PatchOperation
  path: string
  value?: any
}

interface MemoryMetrics {
  documentCount: number
  signalCount: number
  activeSubscriberCount: number
}

interface DocumentReference {
  type: DocumentType
  id: DocumentId
}

interface SubscriptionEvent<T = any> {
  type: DocumentType
  id: DocumentId
  document: T
  action?: 'set' | 'update' | 'remove'
}

interface SubscriptionDebugInfo {
  totalSubscriptions: number
  subscriptionsByDocument: Record<string, number>
}

interface DocumentSignal<T> {
  value: T | null
  subscribe: (callback: (value: T | null) => void) => () => void
}

class SubscriptionManager {
  private unsubscribeFunctions: (() => void)[] = []

  add(unsubscribe: () => void): void {
    this.unsubscribeFunctions.push(unsubscribe)
  }

  unsubscribeAll(): void {
    this.unsubscribeFunctions.forEach(unsub => unsub())
    this.unsubscribeFunctions = []
  }
}

class SubscriptionScope {
  private store: DocumentStore
  private unsubscribeFunctions: (() => void)[] = []

  constructor(store: DocumentStore) {
    this.store = store
  }

  subscribe<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    callback: (document: T | null) => void
  ): void {
    const signal = this.store.getDocumentSignal<T>(type, id)
    const unsubscribe = signal.subscribe(callback)
    this.unsubscribeFunctions.push(unsubscribe)
  }

  dispose(): void {
    this.unsubscribeFunctions.forEach(unsub => unsub())
    this.unsubscribeFunctions = []
  }
}

export class DocumentStore {
  private documents = new Map<DocumentKey, Document>()
  private signals = new Map<DocumentKey, any>()
  private documentSignals = new Map<DocumentKey, DocumentSignal<any>>()
  private subscriberCounts = new Map<DocumentKey, number>()
  private typeListeners = new Map<
    DocumentType,
    ((event: SubscriptionEvent) => void)[]
  >()

  private getKey(type: DocumentType, id: DocumentId): DocumentKey {
    return `${type}:${id}`
  }

  setDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    document: T
  ): void {
    const key = this.getKey(type, id)
    this.documents.set(key, document)

    // Update signal if it exists
    const signal = this.signals.get(key)
    if (signal) {
      signal.value = document
    }

    // Notify type listeners
    this.notifyTypeListeners(type, id, document, 'set')
  }

  getDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): T | null {
    const key = this.getKey(type, id)
    const document = this.documents.get(key)
    return document ? (document as T) : null
  }

  // Get the deep signal directly for atomic updates with alien-deepsignals
  getDeepSignal(type: DocumentType, id: DocumentId): any {
    const key = this.getKey(type, id)

    if (!this.signals.has(key)) {
      const existingDocument = this.documents.get(key)

      // alien-deepsignals can't observe null, so we use an empty object
      // and track existence separately
      const initialValue = existingDocument
        ? JSON.parse(JSON.stringify(existingDocument))
        : {}

      // Create a deep signal using alien-deepsignals
      const deepSig = deepSignal(initialValue as any)

      // If there's no existing document, mark the signal as empty
      if (!existingDocument) {
        deepSig._isEmpty = true
      }

      this.signals.set(key, deepSig)
      this.subscriberCounts.set(key, 0)

      return deepSig
    }

    return this.signals.get(key)!
  }

  getDocumentSignal<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): DocumentSignal<T> {
    const key = this.getKey(type, id)

    // Return cached DocumentSignal if it exists
    if (this.documentSignals.has(key)) {
      return this.documentSignals.get(key)! as DocumentSignal<T>
    }

    const deepSig = this.getDeepSignal(type, id)
    const callbacks = new Set<(value: T | null) => void>()
    const self = this

    const documentSignal: DocumentSignal<T> = {
      get value() {
        // If the signal is marked as empty, return null
        return deepSig._isEmpty ? null : deepSig
      },
      set value(newValue: T | null) {
        const oldValue = deepSig._isEmpty ? null : deepSig

        if (newValue === null) {
          // Clear the signal and mark it as empty
          Object.keys(deepSig).forEach(key => {
            if (key !== '_isEmpty') delete deepSig[key]
          })
          deepSig._isEmpty = true
        } else {
          // Set new value and remove empty flag
          Object.keys(deepSig).forEach(key => {
            if (key !== '_isEmpty') delete deepSig[key]
          })
          Object.assign(deepSig, newValue)
          delete deepSig._isEmpty
        }

        // Update documents map
        if (newValue) {
          self.documents.set(key, newValue)
        } else {
          self.documents.delete(key)
        }

        // Manually trigger callbacks for compatibility
        if (oldValue !== newValue) {
          callbacks.forEach(callback => callback(newValue))
        }
      },
      subscribe: (callback: (value: T | null) => void) => {
        callbacks.add(callback)

        // Increment subscriber count
        const currentCount = self.subscriberCounts.get(key) || 0
        self.subscriberCounts.set(key, currentCount + 1)

        // Return unsubscribe function
        return () => {
          callbacks.delete(callback)
          const count = self.subscriberCounts.get(key) || 0
          self.subscriberCounts.set(key, Math.max(0, count - 1))
        }
      },
    }

    // Cache the DocumentSignal
    this.documentSignals.set(key, documentSignal)
    return documentSignal
  }

  removeDocument(type: DocumentType, id: DocumentId): void {
    const key = this.getKey(type, id)

    // Remove document
    this.documents.delete(key)

    // Set signal value to null and clean up
    const signal = this.signals.get(key)
    if (signal) {
      signal.value = null
      this.signals.delete(key)
      this.subscriberCounts.delete(key)
    }

    // Clean up cached DocumentSignal
    this.documentSignals.delete(key)

    // Notify type listeners
    this.notifyTypeListeners(type, id, null as any, 'remove')
  }

  cleanup(): void {
    // Remove signals with no active subscribers
    const keysToRemove: DocumentKey[] = []

    for (const [key, count] of this.subscriberCounts.entries()) {
      if (count === 0) {
        keysToRemove.push(key)
      }
    }

    keysToRemove.forEach(key => {
      this.signals.delete(key)
      this.subscriberCounts.delete(key)
    })
  }

  getSignalCount(): number {
    return this.signals.size
  }

  getMemoryMetrics(): MemoryMetrics {
    let totalSubscriptions = 0
    for (const count of this.subscriberCounts.values()) {
      totalSubscriptions += count
    }

    return {
      documentCount: this.documents.size,
      signalCount: this.signals.size,
      activeSubscriberCount: totalSubscriptions,
    }
  }

  private notifyTypeListeners<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    document: T,
    action: 'set' | 'update' | 'remove'
  ): void {
    const listeners = this.typeListeners.get(type)
    if (listeners) {
      const event: SubscriptionEvent<T> = { type, id, document, action }
      listeners.forEach(listener => listener(event))
    }
  }

  // Signal Utility Methods

  subscribeToMultiple<T extends Document>(
    references: DocumentReference[],
    callback: (event: SubscriptionEvent<T>) => void
  ): () => void {
    const unsubscribeFunctions: (() => void)[] = []

    references.forEach(ref => {
      const signal = this.getDocumentSignal<T>(ref.type, ref.id)
      const unsubscribe = signal.subscribe(document => {
        if (document) {
          callback({
            type: ref.type,
            id: ref.id,
            document,
            action: 'update',
          })
        }
      })
      unsubscribeFunctions.push(unsubscribe)
    })

    return () => {
      unsubscribeFunctions.forEach(unsub => unsub())
    }
  }

  createSubscriptionManager(): SubscriptionManager {
    return new SubscriptionManager()
  }

  createSubscriptionScope(): SubscriptionScope {
    return new SubscriptionScope(this)
  }

  subscribeConditional<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    condition: (document: T | null) => boolean,
    callback: (document: T | null) => void
  ): () => void {
    const signal = this.getDocumentSignal<T>(type, id)
    return signal.subscribe(document => {
      if (condition(document)) {
        callback(document)
      }
    })
  }

  subscribeDebounced<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    callback: (document: T | null) => void,
    delay: number
  ): () => void {
    let timeoutId: NodeJS.Timeout | null = null

    const signal = this.getDocumentSignal<T>(type, id)
    return signal.subscribe(document => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        callback(document)
        timeoutId = null
      }, delay)
    })
  }

  subscribeOnce<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    callback: (document: T | null) => void
  ): void {
    const signal = this.getDocumentSignal<T>(type, id)
    let hasTriggered = false

    let unsubscribe: () => void

    unsubscribe = signal.subscribe(document => {
      if (!hasTriggered && unsubscribe) {
        hasTriggered = true
        callback(document)
        setTimeout(() => unsubscribe(), 0)
      }
    })
  }

  getSubscriptionDebugInfo(): SubscriptionDebugInfo {
    const subscriptionsByDocument: Record<string, number> = {}
    let totalSubscriptions = 0

    for (const [key, count] of this.subscriberCounts.entries()) {
      subscriptionsByDocument[key] = count
      totalSubscriptions += count
    }

    return {
      totalSubscriptions,
      subscriptionsByDocument,
    }
  }

  subscribeToDocumentType<T extends Document>(
    type: DocumentType,
    callback: (event: SubscriptionEvent<T>) => void
  ): () => void {
    const listeners = this.typeListeners.get(type) || []
    listeners.push(callback)
    this.typeListeners.set(type, listeners)

    return () => {
      const currentListeners = this.typeListeners.get(type) || []
      const index = currentListeners.indexOf(callback)
      if (index >= 0) {
        currentListeners.splice(index, 1)
        if (currentListeners.length === 0) {
          this.typeListeners.delete(type)
        }
      }
    }
  }
}

export function update(
  signal: any,
  patches: Patch[],
  store?: DocumentStore,
  type?: DocumentType,
  id?: DocumentId
): void {
  for (const patch of patches) {
    switch (patch.op) {
      case '$set': {
        // Use direct mutation as recommended by alien-deepsignals
        setValueAtPath(signal, patch.path, patch.value)
        break
      }

      case '$unset': {
        deleteValueAtPath(signal, patch.path)
        break
      }

      case '$push': {
        const arrayRef = getValueAtPath(signal, patch.path)
        if (Array.isArray(arrayRef)) {
          arrayRef.push(patch.value)
        }
        break
      }

      case '$pull': {
        const arrayRef = getValueAtPath(signal, patch.path)
        if (Array.isArray(arrayRef)) {
          for (let i = arrayRef.length - 1; i >= 0; i--) {
            const item = arrayRef[i]
            let shouldRemove = false
            if (typeof item === 'object' && typeof patch.value === 'object') {
              if (item.id && patch.value.id) {
                shouldRemove = item.id === patch.value.id
              } else {
                shouldRemove =
                  JSON.stringify(item) === JSON.stringify(patch.value)
              }
            } else {
              shouldRemove = item === patch.value
            }
            if (shouldRemove) {
              arrayRef.splice(i, 1)
            }
          }
        }
        break
      }
    }
  }

  // Sync signal changes back to the document store and trigger callbacks
  if (store && type && id) {
    const key = store['getKey'](type, id)
    const currentDoc = { ...signal }
    // Remove alien-deepsignals internal properties
    delete currentDoc._isEmpty
    store['documents'].set(key, currentDoc)

    // Trigger the DocumentSignal callbacks by setting the signal value
    const docSignal = store.getDocumentSignal(type, id)
    docSignal.value = currentDoc
  }
}

function setValueAtPath(obj: any, path: string, value: any): void {
  if (!path) {
    // Cannot set root - alien-deepsignals doesn't support this
    return
  }

  const pathParts = path.split('.')
  let current = obj

  // Navigate to parent
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i]!
    if (!(part in current)) {
      current[part] = {}
    }
    current = current[part]
  }

  // Set the final value
  const lastPart = pathParts[pathParts.length - 1]!
  current[lastPart] = value
}

function deleteValueAtPath(obj: any, path: string): void {
  if (!path) {
    return
  }

  const pathParts = path.split('.')
  let current = obj

  // Navigate to parent
  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i]!
    current = current[part]
    if (!current) return
  }

  // Delete the final property
  const lastPart = pathParts[pathParts.length - 1]!
  delete current[lastPart]
}

function getValueAtPath(obj: any, path: string): any {
  if (!path) {
    return obj
  }

  const pathParts = path.split('.')
  let current = obj

  for (const part of pathParts) {
    current = current[part]
    if (current === undefined || current === null) {
      return undefined
    }
  }

  return current
}
