import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'
import { deepSignal } from 'alien-deepsignals'

function setNestedValue(obj: any, path: string, value: any): any {
  const keys = path.split('.').filter(Boolean)
  const result = structuredClone(obj)
  let current = result

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (key && (!(key in current) || typeof current[key] !== 'object')) {
      current[key] = {}
    }
    if (key) {
      current = current[key]
    }
  }

  const lastKey = keys[keys.length - 1]
  if (lastKey) {
    current[lastKey] = value
  }
  return result
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

  updateDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    updater: (document: T) => T
  ): void {
    const key = this.getKey(type, id)
    const currentDocument = this.documents.get(key) as T

    if (currentDocument) {
      const updatedDocument = updater(currentDocument)
      this.documents.set(key, updatedDocument)

      // Update signal if it exists
      const signal = this.signals.get(key)
      if (signal) {
        signal.value = updatedDocument
      }

      // Notify type listeners
      this.notifyTypeListeners(type, id, updatedDocument, 'update')
    }
  }

  // Get the deep signal directly for atomic updates with alien-deepsignals
  getDeepSignal<T extends Document>(type: DocumentType, id: DocumentId): any {
    const key = this.getKey(type, id)

    if (!this.signals.has(key)) {
      const existingDocument = this.documents.get(key)
      const initialValue = existingDocument ? (existingDocument as T) : null

      // Create a deep signal using alien-deepsignals
      const deepSig = deepSignal(initialValue as any)
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
    const deepSig = this.getDeepSignal<T>(type, id)

    const callbacks = new Set<(value: T | null) => void>()
    const self = this

    return {
      get value() {
        return deepSig.value
      },
      set value(newValue: T | null) {
        const oldValue = deepSig.value
        deepSig.value = newValue

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
  }

  updateField<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    path: string,
    value: any
  ): void {
    const key = this.getKey(type, id)
    const currentDocument = this.documents.get(key)

    if (currentDocument) {
      const updatedDocument = setNestedValue(currentDocument, path, value) as T
      this.documents.set(key, updatedDocument)

      // Update signal if it exists
      const signal = this.signals.get(key)
      if (signal) {
        signal.value = updatedDocument
      }
    }
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
