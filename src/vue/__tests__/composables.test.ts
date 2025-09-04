import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { DocumentStore } from '../../core/store'
import { useDocument, useDocuments, useDocumentStore } from '../index'
import { mount } from '@vue/test-utils'

interface TestUser {
  id: string
  name: string
  email: string
}

describe('Vue Composables - Core Functionality', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('useDocument', () => {
    it('should return null for a document that does not exist', async () => {
      let result: TestUser | null = null

      const TestComponent = {
        setup() {
          result = useDocument<TestUser>(store, 'user', 'nonexistent').value
          return () => null
        },
      }

      mount(TestComponent)
      await nextTick()
      expect(result).toBeNull()
    })

    it('should return the document data when it exists', async () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)

      let result: TestUser | null = null

      const TestComponent = {
        setup() {
          const userRef = useDocument<TestUser>(store, 'user', 'user1')
          result = userRef.value
          return () => null
        },
      }

      mount(TestComponent)
      await nextTick()
      expect(result).toEqual(user)
    })
  })

  describe('useDocuments', () => {
    it('should return an array of nulls for documents that do not exist', async () => {
      let result: (TestUser | null)[] = []

      const TestComponent = {
        setup() {
          const documentsRef = useDocuments<TestUser>(store, 'user', [
            'user1',
            'user2',
          ])
          result = documentsRef.value
          return () => null
        },
      }

      mount(TestComponent)
      await nextTick()
      expect(result).toEqual([null, null])
    })

    it('should return an array of documents when they exist', async () => {
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

      let result: (TestUser | null)[] = []

      const TestComponent = {
        setup() {
          const documentsRef = useDocuments<TestUser>(store, 'user', [
            'user1',
            'user2',
          ])
          result = documentsRef.value
          return () => null
        },
      }

      mount(TestComponent)
      await nextTick()
      expect(result).toEqual([user1, user2])
    })
  })

  describe('useDocumentStore', () => {
    it('should return the document store', () => {
      let result: DocumentStore | null = null

      const TestComponent = {
        setup() {
          result = useDocumentStore(store)
          return () => null
        },
      }

      mount(TestComponent)
      expect(result).toBe(store)
    })
  })
})
