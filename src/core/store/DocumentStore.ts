import type { Document, DocumentType, DocumentId, DocumentKey } from '../types'
import { createDeepProxy, Subscriber } from '../createDeepProxy'

type PatchOperation = '$set' | '$unset' | '$push' | '$pull'

export interface Patch {
  op: PatchOperation
  path: string
  value?: any
}

interface MemoryMetrics {
  documentCount: number
  proxyCount: number
  activeSubscriberCount: number
}

export class DocumentStore {
  // Stores the plain, non-reactive document data for snapshots.
  private documents = new Map<DocumentKey, Document>()
  // Caches the reactive proxies to maintain object identity.
  private proxies = new Map<DocumentKey, any>()
  // Stores subscribers for each document.
  private subscribers = new Map<DocumentKey, Set<Subscriber>>()

  public getKey(type: DocumentType, id: DocumentId): DocumentKey {
    return `${type}:${id}`
  }

  setDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId,
    document: T
  ): void {
    const key = this.getKey(type, id)
    // Store a deep copy to prevent mutations from outside the store.
    this.documents.set(key, JSON.parse(JSON.stringify(document)))
    // Invalidate any existing proxy for this document.
    this.proxies.delete(key)
    // Notify subscribers about the change.
    this._notify(key)
  }

  /**
   * Returns a reactive proxy of a document. Mutations to this object will trigger
   * subscribers. The proxy is cached to ensure object identity is preserved.
   */
  getDocument<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): T | null {
    const key = this.getKey(type, id)

    if (this.proxies.has(key)) {
      return this.proxies.get(key)
    }

    const doc = this.documents.get(key)
    if (!doc) {
      return null
    }

    // Create a new proxy that notifies subscribers on change.
    const proxy = createDeepProxy(doc, () => {
      // When the proxy is mutated, update the snapshot and notify subscribers.
      // A new deep copy is created for the snapshot.
      this.documents.set(key, JSON.parse(JSON.stringify(proxy)))
      this._notify(key)
    })

    this.proxies.set(key, proxy)
    return proxy as T
  }

  /**
   * Returns a non-reactive snapshot of a document for use with useSyncExternalStore.
   */
  getDocumentSnapshot<T extends Document>(
    type: DocumentType,
    id: DocumentId
  ): T | null {
    const key = this.getKey(type, id)
    return (this.documents.get(key) as T) ?? null
  }

  removeDocument(type: DocumentType, id: DocumentId): void {
    const key = this.getKey(type, id)
    this.documents.delete(key)
    this.proxies.delete(key)
    this._notify(key)
    // Also remove subscribers to prevent memory leaks
    this.subscribers.delete(key)
  }

  getMemoryMetrics(): MemoryMetrics {
    let subscriberCount = 0
    this.subscribers.forEach(subSet => (subscriberCount += subSet.size))
    return {
      documentCount: this.documents.size,
      proxyCount: this.proxies.size, // Represents reactive proxies
      activeSubscriberCount: subscriberCount,
    }
  }

  subscribe(
    type: DocumentType,
    id: DocumentId,
    callback: Subscriber
  ): () => void {
    const key = this.getKey(type, id)
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }
    const subSet = this.subscribers.get(key)!
    subSet.add(callback)

    // Return the unsubscribe function.
    return () => {
      subSet.delete(callback)
      // Clean up the Set if it becomes empty to prevent memory leaks.
      if (subSet.size === 0) {
        this.subscribers.delete(key)
      }
    }
  }

  /**
   * Notifies all subscribers for a given document key that a change has occurred.
   */
  private _notify(key: DocumentKey): void {
    if (this.subscribers.has(key)) {
      this.subscribers.get(key)!.forEach(callback => callback())
    }
  }
}

export function update(
  store: DocumentStore,
  type: DocumentType,
  id: DocumentId,
  patches: Patch[]
): void {
  const docProxy = store.getDocument(type, id)
  if (!docProxy) {
    console.warn(`Document with type '${type}' and id '${id}' not found.`)
    return
  }

  // The proxy will automatically notify subscribers upon mutation.
  for (const patch of patches) {
    switch (patch.op) {
      case '$set': {
        setValueAtPath(docProxy, patch.path, patch.value)
        break
      }
      case '$unset': {
        deleteValueAtPath(docProxy, patch.path)
        break
      }
      case '$push': {
        const arrayRef = getValueAtPath(docProxy, patch.path)
        if (Array.isArray(arrayRef)) {
          // Create a new array to ensure immutability for snapshot-based systems.
          setValueAtPath(docProxy, patch.path, [...arrayRef, patch.value])
        }
        break
      }
      case '$pull': {
        const arrayRef = getValueAtPath(docProxy, patch.path)
        if (Array.isArray(arrayRef)) {
          // Use filter to create a new array, ensuring immutability.
          const newArray = arrayRef.filter(item => {
            if (
              patch.value &&
              typeof item === 'object' &&
              item !== null &&
              typeof patch.value === 'object'
            ) {
              if (item.id && patch.value.id) {
                return item.id !== patch.value.id
              }
              // Fallback to deep equality for objects without IDs.
              return JSON.stringify(item) !== JSON.stringify(patch.value)
            }
            return item !== patch.value
          })
          setValueAtPath(docProxy, patch.path, newArray)
        }
        break
      }
    }
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
