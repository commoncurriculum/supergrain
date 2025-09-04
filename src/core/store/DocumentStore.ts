import { signal, type Signal } from '@preact/signals-core'
import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'

function setNestedValue(obj: any, path: string, value: any): any {
  const keys = path.split('.')
  const result = structuredClone(obj)
  let current = result

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {}
    }
    current = current[key]
  }

  current[keys[keys.length - 1]] = value
  return result
}

interface MemoryMetrics {
  documentCount: number
  signalCount: number
  activeSubscriberCount: number
}

export class DocumentStore {
  private documents = new Map<DocumentKey, Document>()
  private signals = new Map<DocumentKey, Signal<Document | null>>()
  private subscriberCounts = new Map<DocumentKey, number>()

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
    const documentSignal = this.signals.get(key)
    if (documentSignal) {
      documentSignal.value = document
    }
  }

  getDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): T | null {
    const key = this.getKey(type, id)
    const document = this.documents.get(key)
    return document ? (document as T) : null
  }

  getDocumentSignal<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): Signal<T | null> {
    const key = this.getKey(type, id)

    if (!this.signals.has(key)) {
      const existingDocument = this.documents.get(key)
      const docSignal = signal<T | null>(
        existingDocument ? (existingDocument as T) : null
      )

      // Wrap the signal to track subscribers
      const originalSubscribe = docSignal.subscribe.bind(docSignal)
      docSignal.subscribe = (fn: (value: T | null) => void) => {
        // Increment subscriber count
        const currentCount = this.subscriberCounts.get(key) || 0
        this.subscriberCounts.set(key, currentCount + 1)

        const unsubscribe = originalSubscribe(fn)

        // Return wrapped unsubscribe that decrements count
        return () => {
          const count = this.subscriberCounts.get(key) || 0
          this.subscriberCounts.set(key, Math.max(0, count - 1))
          unsubscribe()
        }
      }

      this.signals.set(key, docSignal)
      this.subscriberCounts.set(key, 0)
    }

    return this.signals.get(key)! as Signal<T | null>
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
      const documentSignal = this.signals.get(key)
      if (documentSignal) {
        documentSignal.value = updatedDocument
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
    let totalSubscribers = 0
    for (const count of this.subscriberCounts.values()) {
      totalSubscribers += count
    }

    return {
      documentCount: this.documents.size,
      signalCount: this.signals.size,
      activeSubscriberCount: totalSubscribers,
    }
  }
}
