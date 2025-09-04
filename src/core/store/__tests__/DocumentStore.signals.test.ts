import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentStore } from '../DocumentStore'
import type { Document } from '../../types'

interface TestUser extends Document {
  name: string
  email: string
}

describe('DocumentStore - Signal Integration', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('signal creation and updates', () => {
    it('should return a signal when getting a document', () => {
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      expect(signal).toBeDefined()
      expect(typeof signal.value).toBe('object')
      expect(signal.value).toBeNull() // Initially null
    })

    it('should update signal value when document is set', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      const signal = store.getDocumentSignal<TestUser>('user', 'user1')
      expect(signal.value).toBeNull()

      store.setDocument('user', 'user1', user)
      expect(signal.value).toEqual(user)
    })

    it('should return the same signal instance for multiple calls with same type and ID', () => {
      const signal1 = store.getDocumentSignal<TestUser>('user', 'user1')
      const signal2 = store.getDocumentSignal<TestUser>('user', 'user1')

      expect(signal1).toBe(signal2)
    })

    it('should return different signals for different document types or IDs', () => {
      const userSignal = store.getDocumentSignal<TestUser>('user', 'user1')
      const userSignal2 = store.getDocumentSignal<TestUser>('user', 'user2')
      const postSignal = store.getDocumentSignal('post', 'user1')

      expect(userSignal).not.toBe(userSignal2)
      expect(userSignal).not.toBe(postSignal)
      expect(userSignal2).not.toBe(postSignal)
    })

    it('should trigger signal subscribers when document changes', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      const signal = store.getDocumentSignal<TestUser>('user', 'user1')
      const mockCallback = vi.fn()

      // Subscribe to signal changes
      const unsubscribe = signal.subscribe(mockCallback)

      store.setDocument('user', 'user1', user)
      expect(mockCallback).toHaveBeenCalledWith(user)

      unsubscribe()
    })

    it('should support multiple subscribers to the same signal', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      const signal = store.getDocumentSignal<TestUser>('user', 'user1')
      const mockCallback1 = vi.fn()
      const mockCallback2 = vi.fn()

      signal.subscribe(mockCallback1)
      signal.subscribe(mockCallback2)

      store.setDocument('user', 'user1', user)

      expect(mockCallback1).toHaveBeenCalledWith(user)
      expect(mockCallback2).toHaveBeenCalledWith(user)
    })

    it('should maintain backward compatibility with getDocument method', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)

      // Both methods should return the same value
      const directValue = store.getDocument<TestUser>('user', 'user1')
      const signalValue = store.getDocumentSignal<TestUser>(
        'user',
        'user1'
      ).value

      expect(directValue).toEqual(signalValue)
      expect(directValue).toEqual(user)
    })
  })
})
