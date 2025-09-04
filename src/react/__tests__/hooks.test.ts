import { DocumentStore } from '../../core/store'
import { useDocument, useDocuments, useDocumentStore } from '../'
import { renderHook, act } from '@testing-library/react'

interface User {
  id: string
  name: string
  email: string
}

describe('useDocument', () => {
  it('should return null for a document that does not exist', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocument(store, 'user', '1'))
    expect(result.current).toBeNull()
  })
})

describe('useDocuments', () => {
  it('should return an array of nulls for documents that do not exist', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocuments(store, 'user', ['1', '2']))
    expect(result.current).toEqual([null, null])
  })
})

describe('useDocumentStore', () => {
  it('should return the document store', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocumentStore(store))
    expect(result.current).toBe(store)
  })
})

describe('React Hooks Memory Management', () => {
  describe('useDocument cleanup', () => {
    it('should clean up signal subscriptions when component unmounts', () => {
      const store = new DocumentStore()

      // Get initial subscription count
      const initialMetrics = store.getMemoryMetrics()
      expect(initialMetrics.activeSubscriberCount).toBe(0)

      // Render hook and verify subscription is created
      const { unmount } = renderHook(() =>
        useDocument<User>(store, 'user', '1')
      )

      const afterMountMetrics = store.getMemoryMetrics()
      expect(afterMountMetrics.activeSubscriberCount).toBe(1)

      // Unmount and verify subscription is cleaned up
      unmount()

      const afterUnmountMetrics = store.getMemoryMetrics()
      expect(afterUnmountMetrics.activeSubscriberCount).toBe(0)
    })

    it('should clean up multiple signal subscriptions when component unmounts', () => {
      const store = new DocumentStore()

      const { unmount } = renderHook(() => {
        const user1 = useDocument<User>(store, 'user', '1')
        const user2 = useDocument<User>(store, 'user', '2')
        const profile1 = useDocument<User>(store, 'profile', '1')
        return { user1, user2, profile1 }
      })

      const afterMountMetrics = store.getMemoryMetrics()
      expect(afterMountMetrics.activeSubscriberCount).toBe(3)

      unmount()

      const afterUnmountMetrics = store.getMemoryMetrics()
      expect(afterUnmountMetrics.activeSubscriberCount).toBe(0)
    })

    it('should not affect subscriptions from other components when one unmounts', () => {
      const store = new DocumentStore()

      const hook1 = renderHook(() => useDocument<User>(store, 'user', '1'))
      const hook2 = renderHook(() => useDocument<User>(store, 'user', '1'))

      const afterBothMountMetrics = store.getMemoryMetrics()
      expect(afterBothMountMetrics.activeSubscriberCount).toBe(2)

      // Unmount first hook
      hook1.unmount()

      const afterFirstUnmountMetrics = store.getMemoryMetrics()
      expect(afterFirstUnmountMetrics.activeSubscriberCount).toBe(1)

      // Unmount second hook
      hook2.unmount()

      const afterSecondUnmountMetrics = store.getMemoryMetrics()
      expect(afterSecondUnmountMetrics.activeSubscriberCount).toBe(0)
    })
  })

  describe('useDocuments cleanup', () => {
    it('should clean up all signal subscriptions when useDocuments component unmounts', () => {
      const store = new DocumentStore()

      const { unmount } = renderHook(() =>
        useDocuments<User>(store, 'user', ['1', '2', '3'])
      )

      const afterMountMetrics = store.getMemoryMetrics()
      expect(afterMountMetrics.activeSubscriberCount).toBe(3)

      unmount()

      const afterUnmountMetrics = store.getMemoryMetrics()
      expect(afterUnmountMetrics.activeSubscriberCount).toBe(0)
    })

    it('should handle dynamic id arrays and clean up properly', () => {
      const store = new DocumentStore()

      const { rerender, unmount } = renderHook(
        (ids: string[]) => useDocuments<User>(store, 'user', ids),
        { initialProps: ['1', '2'] }
      )

      let metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(2)

      // Change to more IDs
      rerender(['1', '2', '3', '4'])

      metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(4)

      // Change to fewer IDs
      rerender(['1'])

      metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(1)

      // Unmount completely
      unmount()

      metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(0)
    })
  })

  describe('automatic signal cleanup integration', () => {
    it('should trigger automatic store cleanup after component unmounts', () => {
      const store = new DocumentStore()

      const { unmount } = renderHook(() =>
        useDocument<User>(store, 'user', '1')
      )

      let signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Signal should be created

      unmount()

      // Signal should still exist initially
      signalCount = store.getSignalCount()
      expect(signalCount).toBe(1)

      // Manual cleanup should remove unused signals
      store.cleanup()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(0)
    })

    it('should not cleanup signals that still have active subscribers', () => {
      const store = new DocumentStore()

      const hook1 = renderHook(() => useDocument<User>(store, 'user', '1'))
      const hook2 = renderHook(() => useDocument<User>(store, 'user', '1'))

      let signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Only one signal for same document

      // Unmount first hook but keep second
      hook1.unmount()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Signal should still exist

      store.cleanup()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Signal should still exist because hook2 is subscribed

      // Unmount second hook
      hook2.unmount()

      store.cleanup()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(0) // Now signal should be cleaned up
    })
  })

  describe('component re-rendering and signal reactivity', () => {
    it('should automatically re-render when document signal changes', () => {
      const store = new DocumentStore()

      const { result } = renderHook(() => useDocument<User>(store, 'user', '1'))

      expect(result.current).toBeNull()

      // Set document and expect re-render
      act(() => {
        store.setDocument('user', '1', {
          id: '1',
          name: 'John',
          email: 'john@example.com',
        })
      })

      expect(result.current).toEqual({
        id: '1',
        name: 'John',
        email: 'john@example.com',
      })

      // Update document and expect re-render
      act(() => {
        store.updateField('user', '1', 'name', 'Jane')
      })

      expect(result.current).toEqual({
        id: '1',
        name: 'Jane',
        email: 'john@example.com',
      })
    })

    it('should handle rapid signal updates without memory leaks', () => {
      const store = new DocumentStore()

      const { result, unmount } = renderHook(() =>
        useDocument<User>(store, 'user', '1')
      )

      // Rapid updates
      for (let i = 0; i < 100; i++) {
        act(() => {
          store.setDocument('user', '1', {
            id: '1',
            name: `User ${i}`,
            email: 'test@example.com',
          })
        })
      }

      expect(result.current?.name).toBe('User 99')

      const metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(1) // Should still only have 1 subscription

      unmount()

      const finalMetrics = store.getMemoryMetrics()
      expect(finalMetrics.activeSubscriberCount).toBe(0)
    })
  })
})
