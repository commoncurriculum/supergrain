import type { Document, DocumentType, DocumentId } from '../types'

export class DocumentStore {
  setDocument<T extends Document>(
    _type: DocumentType,
    _id: DocumentId,
    _document: T
  ): void {
    throw new Error('Not implemented: DocumentStore.setDocument')
  }

  getDocument<T extends Document>(
    _type: DocumentType,
    _id: DocumentId
  ): T | null {
    throw new Error('Not implemented: DocumentStore.getDocument')
  }
}
