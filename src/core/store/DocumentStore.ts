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

    // Always create a fresh signal to preserve alien-deepsignals reactivity
    const deepSig = deepSignal(JSON.parse(JSON.stringify(document)))
    this.signals.set(key, deepSig)
  }

  getDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): T | null {
    const signal = this.getDeepSignal(type, id)
    return signal._isEmpty ? null : signal
  }

  // Get the deep signal directly for atomic updates with alien-deepsignals
  getDeepSignal(type: DocumentType, id: DocumentId): any {
    const key = this.getKey(type, id)

    if (!this.signals.has(key)) {
      const existingDocument = this.documents.get(key)

      if (existingDocument) {
        // Create signal with existing document
        const deepSig = deepSignal(JSON.parse(JSON.stringify(existingDocument)))
        this.signals.set(key, deepSig)
        return deepSig
      } else {
        // Create empty signal marked as empty
        const deepSig = deepSignal({})
        deepSig._isEmpty = true
        this.signals.set(key, deepSig)
        return deepSig
      }
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

  // Sync changes back to documents map
  const key = store.getKey(type, id)
  const currentDoc = { ...signal }
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
