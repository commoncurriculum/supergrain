import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { DocumentStore, update } from '../DocumentStore'
import type { Document } from '../../types'

interface TestUser extends Document {
  name: string
  email: string
}

describe('DocumentStore - Signal Utilities', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  afterEach(() => {
    // Clean up any timers or subscriptions
    vi.clearAllTimers()
  })

  describe('signal subscription and cleanup utilities', () => {
    it('should provide utility to subscribe to multiple signals at once', () => {
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

      const callback = vi.fn()

      // Should be able to subscribe to multiple documents at once
      const unsubscribe = store.subscribeToMultiple(
        [
          { type: 'user', id: 'user1' },
          { type: 'user', id: 'user2' },
        ],
        callback
      )

      expect(typeof unsubscribe).toBe('function')

      // Reset callback to ignore initial subscription calls
      callback.mockReset()

      // Update one document should trigger callback
      const signal = store.getDeepSignal('user', 'user1')
      update(signal, [{ op: '$set', path: 'name', value: 'John Updated' }])
      expect(callback).toHaveBeenCalledWith({
        type: 'user',
        id: 'user1',
        document: expect.objectContaining({ name: 'John Updated' }),
        action: 'update',
      })

      unsubscribe()
    })

    it('should provide batch subscription cleanup utility', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      const subscriptionManager = store.createSubscriptionManager()

      // Add multiple subscriptions to manager
      subscriptionManager.add(signal.subscribe(() => {}))
      subscriptionManager.add(signal.subscribe(() => {}))
      subscriptionManager.add(signal.subscribe(() => {}))

      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(3)

      // Cleanup all at once
      subscriptionManager.unsubscribeAll()
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(0)
    })

    it('should provide scoped subscription utility that auto-cleans on disposal', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)

      const scope = store.createSubscriptionScope()
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      // Subscribe within scope
      scope.subscribe('user', 'user1', callback1)
      scope.subscribe('user', 'user1', callback2)

      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(2)

      // Update should trigger both callbacks
      const signal = store.getDeepSignal('user', 'user1')
      update(signal, [{ op: '$set', path: 'name', value: 'John Updated' }])
      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      // Dispose scope should cleanup all subscriptions
      scope.dispose()
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(0)
    })

    it('should provide utility for conditional subscriptions', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const callback = vi.fn()

      // Should only trigger callback when condition is met
      const unsubscribe = store.subscribeConditional(
        'user',
        'user1',
        document => document?.name.startsWith('Jane'),
        callback
      )

      // This update shouldn't trigger callback (condition not met)
      const signal = store.getDeepSignal('user', 'user1')
      update(signal, [{ op: '$set', path: 'name', value: 'John Updated' }])
      expect(callback).not.toHaveBeenCalled()

      // This update should trigger callback (condition met)
      const signal2 = store.getDeepSignal('user', 'user1')
      update(signal2, [{ op: '$set', path: 'name', value: 'Jane Doe' }])
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Jane Doe' })
      )

      unsubscribe()
    })

    it('should provide debounced subscription utility', async () => {
      vi.useFakeTimers()

      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const callback = vi.fn()

      // Subscribe with 100ms debounce
      const unsubscribe = store.subscribeDebounced(
        'user',
        'user1',
        callback,
        100
      )

      // Rapid updates should be debounced
      const signal = store.getDeepSignal('user', 'user1')
      update(signal, [{ op: '$set', path: 'name', value: 'John 1' }])
      update(signal, [{ op: '$set', path: 'name', value: 'John 2' }])
      update(signal, [{ op: '$set', path: 'name', value: 'John 3' }])

      // Should not have been called yet
      expect(callback).not.toHaveBeenCalled()

      // Advance timers by 100ms
      vi.advanceTimersByTime(100)

      // Should be called once with final value
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'John 3' })
      )

      unsubscribe()
      vi.useRealTimers()
    })

    it('should provide once subscription utility that auto-unsubscribes', async () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const callback = vi.fn()

      // Subscribe once - should auto-unsubscribe after first trigger
      store.subscribeOnce('user', 'user1', callback)

      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(1)

      // First update should trigger callback and auto-unsubscribe
      const signal = store.getDeepSignal('user', 'user1')
      update(signal, [{ op: '$set', path: 'name', value: 'John Updated' }])
      expect(callback).toHaveBeenCalledTimes(1)

      // Wait for async unsubscribe to complete
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(store.getMemoryMetrics().activeSubscriberCount).toBe(0)

      // Second update should not trigger callback
      const signal2 = store.getDeepSignal('user', 'user1')
      update(signal2, [{ op: '$set', path: 'name', value: 'John Again' }])
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should provide utility to get all active subscriptions for debugging', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      signal.subscribe(() => {})
      signal.subscribe(() => {})

      const debug = store.getSubscriptionDebugInfo()

      expect(debug).toEqual({
        totalSubscriptions: 2,
        subscriptionsByDocument: {
          'user:user1': 2,
        },
      })
    })

    it('should provide utility to subscribe to document type changes', () => {
      const callback = vi.fn()

      // Subscribe to all user type changes
      const unsubscribe = store.subscribeToDocumentType('user', callback)

      // Add users should trigger callback
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

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenNthCalledWith(1, {
        type: 'user',
        id: 'user1',
        document: user1,
        action: 'set',
      })
      expect(callback).toHaveBeenNthCalledWith(2, {
        type: 'user',
        id: 'user2',
        document: user2,
        action: 'set',
      })

      unsubscribe()
    })
  })
})
