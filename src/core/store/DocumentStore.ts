import { signal, type Signal } from '@preact/signals-core'
import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'

export class DocumentStore {
  private documents = new Map<DocumentKey, Document>()
  private signals = new Map<DocumentKey, Signal<Document | null>>()

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
      this.signals.set(
        key,
        signal<T | null>(existingDocument ? (existingDocument as T) : null)
      )
    }

    return this.signals.get(key)! as Signal<T | null>
  }
}
