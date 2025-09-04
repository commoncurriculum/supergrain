import { describe, it, expect, beforeEach } from 'vitest'
import { DocumentStore } from '../DocumentStore'
import type { Document } from '../../types'

interface TestUser extends Document {
  name: string
  email: string
}

interface TestPost extends Document {
  title: string
  content: string
  authorId: string
}

describe('DocumentStore - Basic Storage', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('document storage and retrieval', () => {
    it('should store and retrieve a document by type and ID', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      }

      store.setDocument('user', 'user1', user)
      const retrieved = store.getDocument<TestUser>('user', 'user1')

      expect(retrieved).toEqual(user)
    })

    it('should return null for non-existent documents', () => {
      const retrieved = store.getDocument<TestUser>('user', 'nonexistent')
      expect(retrieved).toBeNull()
    })

    it('should handle multiple document types', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      }

      const post: TestPost = {
        id: 'post1',
        title: 'My First Post',
        content: 'Hello world',
        authorId: 'user1'
      }

      store.setDocument('user', 'user1', user)
      store.setDocument('post', 'post1', post)

      expect(store.getDocument<TestUser>('user', 'user1')).toEqual(user)
      expect(store.getDocument<TestPost>('post', 'post1')).toEqual(post)
    })

    it('should handle multiple documents of the same type', () => {
      const user1: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      }

      const user2: TestUser = {
        id: 'user2',
        name: 'Jane Smith',
        email: 'jane@example.com'
      }

      store.setDocument('user', 'user1', user1)
      store.setDocument('user', 'user2', user2)

      expect(store.getDocument<TestUser>('user', 'user1')).toEqual(user1)
      expect(store.getDocument<TestUser>('user', 'user2')).toEqual(user2)
    })

    it('should overwrite existing documents when setting with same type and ID', () => {
      const originalUser: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      }

      const updatedUser: TestUser = {
        id: 'user1',
        name: 'John Updated',
        email: 'john.updated@example.com'
      }

      store.setDocument('user', 'user1', originalUser)
      store.setDocument('user', 'user1', updatedUser)

      expect(store.getDocument<TestUser>('user', 'user1')).toEqual(updatedUser)
    })

    it('should provide type safety with generics', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com'
      }

      store.setDocument('user', 'user1', user)

      // This should be typed correctly as TestUser | null
      const retrieved = store.getDocument<TestUser>('user', 'user1')

      if (retrieved) {
        // Should have IntelliSense for TestUser properties
        expect(retrieved.name).toBe('John Doe')
        expect(retrieved.email).toBe('john@example.com')
      }
    })
  })
})
