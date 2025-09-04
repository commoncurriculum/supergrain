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
}
