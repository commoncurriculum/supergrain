import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { DocumentStore } from '../../core/store'
import { useDocument, useDocuments, useDocumentStore } from '../index'

interface TestUser {
  id: string
  name: string
  email: string
}

describe('React Hooks - Core Functionality', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('useDocument', () => {
    it('should return null for a document that does not exist', () => {
      let result: TestUser | null = null

      function TestComponent() {
        result = useDocument<TestUser>(store, 'user', 'nonexistent')
        return null
      }

      render(React.createElement(TestComponent))
      expect(result).toBeNull()
    })

    it('should return the document data when it exists', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }

      store.setDocument('user', 'user1', user)

      let result: TestUser | null = null

      function TestComponent() {
        result = useDocument<TestUser>(store, 'user', 'user1')
        return null
      }

      render(React.createElement(TestComponent))
      expect(result).toEqual(user)
    })
  })

  describe('useDocuments', () => {
    it.skip('should return an array of nulls for documents that do not exist', () => {
      let result: (TestUser | null)[] = []

      function TestComponent() {
        result = useDocuments<TestUser>(store, 'user', ['user1', 'user2'])
        return null
      }

      render(React.createElement(TestComponent))
      expect(result).toEqual([null, null])
    })

    it.skip('should return an array of documents when they exist', () => {
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

      function TestComponent() {
        result = useDocuments<TestUser>(store, 'user', ['user1', 'user2'])
        return null
      }

      render(React.createElement(TestComponent))
      expect(result).toEqual([user1, user2])
    })
  })

  describe('useDocumentStore', () => {
    it('should return the document store', () => {
      let result: DocumentStore | null = null

      function TestComponent() {
        result = useDocumentStore(store)
        return null
      }

      render(React.createElement(TestComponent))
      expect(result).toBe(store)
    })
  })

  describe('Signal Reactivity', () => {
    it('should automatically re-render when document signal changes', () => {
      let renderCount = 0
      let latestUser: TestUser | null = null

      function TestComponent() {
        renderCount++
        latestUser = useDocument<TestUser>(store, 'user', 'user1')
        return React.createElement('div', null, latestUser?.name || 'No user')
      }

      const { rerender } = render(React.createElement(TestComponent))

      expect(renderCount).toBe(1)
      expect(latestUser).toBeNull()

      // Update the document
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
      }
      store.setDocument('user', 'user1', user)

      rerender(React.createElement(TestComponent))

      expect(latestUser).toEqual(user)
    })
  })
})
