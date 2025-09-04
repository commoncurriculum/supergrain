import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'
import { deepSignal, watch } from 'alien-deepsignals'

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

export class DocumentStore {
  public documents = new Map<DocumentKey, Document>()
  private signals = new Map<DocumentKey, any>()

  public getKey(type: DocumentType, id: DocumentId): DocumentKey {
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
      // Clear existing properties and set new ones
      Object.keys(signal).forEach(k => {
        if (k !== '_isEmpty') delete signal[k]
      })
      Object.assign(signal, document)
      delete signal._isEmpty
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
      return deepSig
    }

    return this.signals.get(key)!
  }

  removeDocument(type: DocumentType, id: DocumentId): void {
    const key = this.getKey(type, id)

    // Remove document
    this.documents.delete(key)

    // Set signal as empty
    const signal = this.signals.get(key)
    if (signal) {
      Object.keys(signal).forEach(k => {
        if (k !== '_isEmpty') delete signal[k]
      })
      signal._isEmpty = true
    }
  }

  getSignalCount(): number {
    return this.signals.size
  }

  // Minimal compatibility layer for React/Vue hooks using alien-signals directly
  getDocumentSignal<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): { value: T | null; subscribe: (callback: () => void) => () => void } {
    const deepSig = this.getDeepSignal(type, id)

    return {
      get value(): T | null {
        return deepSig._isEmpty ? null : deepSig
      },
      subscribe(callback: () => void) {
        // Use alien-deepsignals watch function
        return watch(deepSig, callback)
      },
    }
  }

  getMemoryMetrics(): MemoryMetrics {
    return {
      documentCount: this.documents.size,
      signalCount: this.signals.size,
      activeSubscriberCount: 0, // alien-signals handles this internally
    }
  }
}

export function update(
  store: DocumentStore,
  type: DocumentType,
  id: DocumentId,
  patches: Patch[]
): void {
  // Get the signal internally instead of receiving it as a parameter
  const signal = store.getDeepSignal(type, id)

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

  // Sync signal changes back to the document store
  const key = store.getKey(type, id)
  const currentDoc = deepClone(signal)
  // Remove alien-deepsignals internal properties
  delete currentDoc._isEmpty
  store.documents.set(key, currentDoc)
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

function deepClone(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item))
  }

  const cloned: any = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key])
    }
  }

  return cloned
}
