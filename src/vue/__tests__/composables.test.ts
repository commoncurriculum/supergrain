import { DocumentStore, update } from '../../core/store'
import { useDocument, useDocuments, useDocumentStore } from '../'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'

interface User {
  id: string
  name: string
  email: string
}

// Helper function to create a test component that uses our composables
function createTestComponent<T>(
  composable: () => T,
  template: string = '<div>{{ result }}</div>'
) {
  return defineComponent({
    setup() {
      const result = composable()
      return { result }
    },
    template,
  })
}

describe('useDocument', () => {
  it('should return null for a document that does not exist', async () => {
    const store = new DocumentStore()

    const TestComponent = createTestComponent(() =>
      useDocument(store, 'user', '1')
    )

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result).toBeNull()
  })

  it('should return the document data when it exists', async () => {
    const store = new DocumentStore()

    const user: User = {
      id: '1',
      name: 'John',
      email: 'john@example.com',
    }

    store.setDocument('user', '1', user)

    const TestComponent = createTestComponent(() =>
      useDocument<User>(store, 'user', '1')
    )

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result).toEqual(user)
  })

  it('should reactively update when document changes', async () => {
    const store = new DocumentStore()

    const TestComponent = createTestComponent(
      () => useDocument<User>(store, 'user', '1'),
      '<div>{{ result?.name || "null" }}</div>'
    )

    const wrapper = mount(TestComponent)

    expect(wrapper.text()).toBe('null')

    // Set initial document
    store.setDocument('user', '1', {
      id: '1',
      name: 'John',
      email: 'john@example.com',
    })

    await nextTick()
    expect(wrapper.text()).toBe('John')

    // Update document name
    const signal = store.getDeepSignal('user', '1')
    update(signal, [{ op: '$set', path: 'name', value: 'Jane' }])

    await nextTick()
    expect(wrapper.text()).toBe('Jane')
  })
})

describe('useDocuments', () => {
  it('should return an array of nulls for documents that do not exist', async () => {
    const store = new DocumentStore()

    const TestComponent = createTestComponent(() =>
      useDocuments(store, 'user', ['1', '2'])
    )

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result).toEqual([null, null])
  })

  it('should return an array of documents when they exist', async () => {
    const store = new DocumentStore()

    const user1: User = { id: '1', name: 'John', email: 'john@example.com' }
    const user2: User = { id: '2', name: 'Jane', email: 'jane@example.com' }

    store.setDocument('user', '1', user1)
    store.setDocument('user', '2', user2)

    const TestComponent = createTestComponent(() =>
      useDocuments<User>(store, 'user', ['1', '2'])
    )

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result).toEqual([user1, user2])
  })

  it('should reactively update when any document changes', async () => {
    const store = new DocumentStore()

    const TestComponent = createTestComponent(
      () => useDocuments<User>(store, 'user', ['1', '2']),
      '<div>{{ result.map(u => u?.name).join(",") }}</div>'
    )

    const wrapper = mount(TestComponent)

    expect(wrapper.text()).toBe(',')

    // Set first document
    store.setDocument('user', '1', {
      id: '1',
      name: 'John',
      email: 'john@example.com',
    })

    await nextTick()
    expect(wrapper.text()).toBe('John,')

    // Set second document
    store.setDocument('user', '2', {
      id: '2',
      name: 'Jane',
      email: 'jane@example.com',
    })

    await nextTick()
    expect(wrapper.text()).toBe('John,Jane')

    // Update first document
    const signal = store.getDeepSignal('user', '1')
    update(signal, [{ op: '$set', path: 'name', value: 'Johnny' }])

    await nextTick()
    expect(wrapper.text()).toBe('Johnny,Jane')
  })
})

describe('useDocumentStore', () => {
  it('should return the document store', async () => {
    const store = new DocumentStore()

    const TestComponent = createTestComponent(() => useDocumentStore(store))

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result).toBe(store)
  })
})

describe('Vue Composables Memory Management', () => {
  describe('useDocument cleanup', () => {
    it('should clean up signal subscriptions when component unmounts', async () => {
      const store = new DocumentStore()

      // Get initial subscription count
      const initialMetrics = store.getMemoryMetrics()
      expect(initialMetrics.activeSubscriberCount).toBe(0)

      // Mount component and verify subscription is created
      const TestComponent = createTestComponent(() =>
        useDocument<User>(store, 'user', '1')
      )

      const wrapper = mount(TestComponent)

      const afterMountMetrics = store.getMemoryMetrics()
      expect(afterMountMetrics.activeSubscriberCount).toBe(1)

      // Unmount and verify subscription is cleaned up
      wrapper.unmount()

      const afterUnmountMetrics = store.getMemoryMetrics()
      expect(afterUnmountMetrics.activeSubscriberCount).toBe(0)
    })

    it('should clean up multiple signal subscriptions when component unmounts', async () => {
      const store = new DocumentStore()

      const TestComponent = defineComponent({
        setup() {
          const user1 = useDocument<User>(store, 'user', '1')
          const user2 = useDocument<User>(store, 'user', '2')
          const profile1 = useDocument<User>(store, 'profile', '1')
          return { user1, user2, profile1 }
        },
        template: '<div>Test</div>',
      })

      const wrapper = mount(TestComponent)

      const afterMountMetrics = store.getMemoryMetrics()
      expect(afterMountMetrics.activeSubscriberCount).toBe(3)

      wrapper.unmount()

      const afterUnmountMetrics = store.getMemoryMetrics()
      expect(afterUnmountMetrics.activeSubscriberCount).toBe(0)
    })

    it('should not affect subscriptions from other components when one unmounts', async () => {
      const store = new DocumentStore()

      const TestComponent1 = createTestComponent(() =>
        useDocument<User>(store, 'user', '1')
      )
      const TestComponent2 = createTestComponent(() =>
        useDocument<User>(store, 'user', '1')
      )

      const wrapper1 = mount(TestComponent1)
      const wrapper2 = mount(TestComponent2)

      const afterBothMountMetrics = store.getMemoryMetrics()
      expect(afterBothMountMetrics.activeSubscriberCount).toBe(2)

      // Unmount first component
      wrapper1.unmount()

      const afterFirstUnmountMetrics = store.getMemoryMetrics()
      expect(afterFirstUnmountMetrics.activeSubscriberCount).toBe(1)

      // Unmount second component
      wrapper2.unmount()

      const afterSecondUnmountMetrics = store.getMemoryMetrics()
      expect(afterSecondUnmountMetrics.activeSubscriberCount).toBe(0)
    })
  })

  describe('useDocuments cleanup', () => {
    it('should clean up all signal subscriptions when useDocuments component unmounts', async () => {
      const store = new DocumentStore()

      const TestComponent = createTestComponent(() =>
        useDocuments<User>(store, 'user', ['1', '2', '3'])
      )

      const wrapper = mount(TestComponent)

      const afterMountMetrics = store.getMemoryMetrics()
      expect(afterMountMetrics.activeSubscriberCount).toBe(3)

      wrapper.unmount()

      const afterUnmountMetrics = store.getMemoryMetrics()
      expect(afterUnmountMetrics.activeSubscriberCount).toBe(0)
    })

    it.skip('should handle dynamic id arrays and clean up properly', async () => {
      const store = new DocumentStore()

      const TestComponent = defineComponent({
        props: {
          ids: {
            type: Array as () => string[],
            required: true,
          },
        },
        setup(props) {
          const documents = useDocuments<User>(store, 'user', props.ids)
          return { documents }
        },
        template: '<div>{{ documents.length }}</div>',
      })

      const wrapper = mount(TestComponent, {
        props: { ids: ['1', '2'] },
      })

      let metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(2)

      // Change to more IDs
      await wrapper.setProps({ ids: ['1', '2', '3', '4'] })

      metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(4)

      // Change to fewer IDs
      await wrapper.setProps({ ids: ['1'] })

      metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(1)

      // Unmount completely
      wrapper.unmount()

      metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(0)
    })
  })

  describe('automatic signal cleanup integration', () => {
    it('should trigger automatic store cleanup after component unmounts', async () => {
      const store = new DocumentStore()

      const TestComponent = createTestComponent(() =>
        useDocument<User>(store, 'user', '1')
      )

      const wrapper = mount(TestComponent)

      let signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Signal should be created

      wrapper.unmount()

      // Signal should still exist initially
      signalCount = store.getSignalCount()
      expect(signalCount).toBe(1)

      // Manual cleanup should remove unused signals
      store.cleanup()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(0)
    })

    it('should not cleanup signals that still have active subscribers', async () => {
      const store = new DocumentStore()

      const TestComponent1 = createTestComponent(() =>
        useDocument<User>(store, 'user', '1')
      )
      const TestComponent2 = createTestComponent(() =>
        useDocument<User>(store, 'user', '1')
      )

      const wrapper1 = mount(TestComponent1)
      const wrapper2 = mount(TestComponent2)

      let signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Only one signal for same document

      // Unmount first component but keep second
      wrapper1.unmount()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Signal should still exist

      store.cleanup()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(1) // Signal should still exist because wrapper2 is subscribed

      // Unmount second component
      wrapper2.unmount()

      store.cleanup()

      signalCount = store.getSignalCount()
      expect(signalCount).toBe(0) // Now signal should be cleaned up
    })
  })

  describe('component re-rendering and signal reactivity', () => {
    it('should automatically re-render when document signal changes', async () => {
      const store = new DocumentStore()

      const TestComponent = createTestComponent(
        () => useDocument<User>(store, 'user', '1'),
        '<div>{{ result?.name || "null" }}</div>'
      )

      const wrapper = mount(TestComponent)

      expect(wrapper.text()).toBe('null')

      // Set document and expect re-render
      store.setDocument('user', '1', {
        id: '1',
        name: 'John',
        email: 'john@example.com',
      })

      await nextTick()
      expect(wrapper.text()).toBe('John')

      // Update document and expect re-render
      const signal = store.getDeepSignal('user', '1')
      update(signal, [{ op: '$set', path: 'name', value: 'Jane' }])

      await nextTick()
      expect(wrapper.text()).toBe('Jane')
    })

    it('should handle rapid signal updates without memory leaks', async () => {
      const store = new DocumentStore()

      const TestComponent = createTestComponent(
        () => useDocument<User>(store, 'user', '1'),
        '<div>{{ result?.name || "null" }}</div>'
      )

      const wrapper = mount(TestComponent)

      // Rapid updates
      for (let i = 0; i < 100; i++) {
        store.setDocument('user', '1', {
          id: '1',
          name: `User ${i}`,
          email: 'test@example.com',
        })
      }

      await nextTick()
      expect(wrapper.text()).toBe('User 99')

      const metrics = store.getMemoryMetrics()
      expect(metrics.activeSubscriberCount).toBe(1) // Should still only have 1 subscription

      wrapper.unmount()

      const finalMetrics = store.getMemoryMetrics()
      expect(finalMetrics.activeSubscriberCount).toBe(0)
    })
  })
})
