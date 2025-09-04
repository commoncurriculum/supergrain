import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'

export class DocumentStore {
  private documents = new Map<DocumentKey, Document>()

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
  }

  getDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): T | null {
    const key = this.getKey(type, id)
    const document = this.documents.get(key)
    return document ? (document as T) : null
  }
}
