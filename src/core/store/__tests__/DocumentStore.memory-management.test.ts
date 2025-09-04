import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentStore } from '../DocumentStore'
import type { Document } from '../../types'

interface TestUser extends Document {
  name: string
  email: string
}

describe('DocumentStore - Memory Management', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('cache management and automatic signal cleanup', () => {
    it('should provide access to cleanup unused signals', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      expect(signal.value).toEqual(user)

      // Should have a method to cleanup unused signals
      expect(typeof store.cleanup).toBe('function')
    })

    it('should cleanup signals that have no active subscribers', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      // Get count before cleanup (should be 1)
      expect(store.getSignalCount()).toBe(1)

      // Subscribe and then unsubscribe
      const unsubscribe = signal.subscribe(() => {})
      unsubscribe()

      // Manual cleanup should remove unused signals
      store.cleanup()
      expect(store.getSignalCount()).toBe(0)
    })

    it('should not cleanup signals that have active subscribers', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      // Subscribe and keep the subscription active
      const unsubscribe = signal.subscribe(() => {})

      // Manual cleanup should not remove signals with active subscribers
      store.cleanup()
      expect(store.getSignalCount()).toBe(1)

      unsubscribe()
    })

    it('should cleanup multiple unused signals at once', () => {
      const user1: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      const user2: TestUser = {
        id: 'user2',
        name: 'Jane Smith',
        email: 'jane@example.com',
      }

      store.setDocument('user', 'user1', user1)
      store.setDocument('user', 'user2', user2)

      const signal1 = store.getDocumentSignal<TestUser>('user', 'user1')
      const signal2 = store.getDocumentSignal<TestUser>('user', 'user2')

      expect(store.getSignalCount()).toBe(2)

      // Subscribe and then unsubscribe both
      const unsubscribe1 = signal1.subscribe(() => {})
      const unsubscribe2 = signal2.subscribe(() => {})

      unsubscribe1()
      unsubscribe2()

      // Cleanup should remove both unused signals
      store.cleanup()
      expect(store.getSignalCount()).toBe(0)
    })

    it('should provide automatic cleanup when signal is garbage collected', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)

      // Create and then lose reference to signal
      let signal = store.getDocumentSignal<TestUser>('user', 'user1')
      expect(store.getSignalCount()).toBe(1)

      // Subscribe briefly
      const unsubscribe = signal.subscribe(() => {})
      unsubscribe()

      // Clear reference
      signal = null as any

      // Force garbage collection simulation by cleanup
      store.cleanup()
      expect(store.getSignalCount()).toBe(0)
    })

    it('should cleanup signals when documents are removed', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      expect(store.getSignalCount()).toBe(1)

      // Remove document should also cleanup associated signal
      store.removeDocument('user', 'user1')

      expect(store.getDocument<TestUser>('user', 'user1')).toBeNull()
      expect(signal.value).toBeNull()
      expect(store.getSignalCount()).toBe(0)
    })

    it('should provide metrics about memory usage', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      store.getDocumentSignal<TestUser>('user', 'user1')

      const metrics = store.getMemoryMetrics()

      expect(typeof metrics.documentCount).toBe('number')
      expect(typeof metrics.signalCount).toBe('number')
      expect(typeof metrics.activeSubscriberCount).toBe('number')

      expect(metrics.documentCount).toBe(1)
      expect(metrics.signalCount).toBe(1)
      expect(metrics.activeSubscriberCount).toBe(0)
    })

    it('should track active subscriber count accurately', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(0)

      const unsubscribe1 = signal.subscribe(() => {})
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(1)

      const unsubscribe2 = signal.subscribe(() => {})
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(2)

      unsubscribe1()
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(1)

      unsubscribe2()
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(0)
    })
  })
})
