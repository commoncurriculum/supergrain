import { describe, it, expect, vi } from 'vitest'
import { AppStore } from '../src/app-store'
import type { DocumentTypes } from '../src/types'

interface User {
  id: number
  firstName: string
  lastName: string
  email: string
}

interface Post {
  id: number
  title: string
  content: string
  userId: number
  likes: number
}

interface TestDocumentTypes extends DocumentTypes {
  users: User
  posts: Post
}

describe('AppStore', () => {
  describe('findDoc without fetch handler', () => {
    it('should return pending state for unfetched document', () => {
      const store = new AppStore<TestDocumentTypes>()
      const doc = store.findDoc('users', 1)

      expect(doc.content).toBeUndefined()
      expect(doc.isPending).toBe(true)
      expect(doc.isSettled).toBe(false)
      expect(doc.isRejected).toBe(false)
      expect(doc.isFulfilled).toBe(false)
    })

    it('should return same DocumentPromise instance for same document', () => {
      const store = new AppStore<TestDocumentTypes>()
      const doc1 = store.findDoc('users', 1)
      const doc2 = store.findDoc('users', 1)

      expect(doc1.isPending).toBe(doc2.isPending)
      expect(doc1.content).toBe(doc2.content)
    })

    it('should handle different document types', () => {
      const store = new AppStore<TestDocumentTypes>()
      const userDoc = store.findDoc('users', 1)
      const postDoc = store.findDoc('posts', 1)

      expect(userDoc.isPending).toBe(true)
      expect(postDoc.isPending).toBe(true)
      expect(userDoc.content).toBeUndefined()
      expect(postDoc.content).toBeUndefined()
    })
  })

  describe('setDocument', () => {
    it('should set document content and mark as fulfilled', () => {
      const store = new AppStore<TestDocumentTypes>()
      const userData: User = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }

      store.setDocument('users', 1, userData)
      const doc = store.findDoc('users', 1)

      expect(doc.content).toEqual(userData)
      expect(doc.isPending).toBe(false)
      expect(doc.isSettled).toBe(true)
      expect(doc.isRejected).toBe(false)
      expect(doc.isFulfilled).toBe(true)
    })

    it('should update existing document', () => {
      const store = new AppStore<TestDocumentTypes>()
      const userData1: User = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }
      const userData2: User = {
        id: 1,
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
      }

      store.setDocument('users', 1, userData1)
      const doc = store.findDoc('users', 1)
      expect(doc.content?.firstName).toBe('John')

      store.setDocument('users', 1, userData2)
      expect(doc.content?.firstName).toBe('Jane')
    })
  })

  describe('setDocumentError', () => {
    it('should set document as rejected with error', () => {
      const store = new AppStore<TestDocumentTypes>()
      const errorMessage = 'User not found'

      store.setDocumentError('users', 1, errorMessage)
      const doc = store.findDoc('users', 1)

      expect(doc.content).toBeUndefined()
      expect(doc.isPending).toBe(false)
      expect(doc.isSettled).toBe(true)
      expect(doc.isRejected).toBe(true)
      expect(doc.isFulfilled).toBe(false)
    })
  })

  describe('with fetch handler', () => {
    it('should call fetch handler for unfetched document', async () => {
      const mockFetchHandler = vi.fn()
      const userData: User = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }

      mockFetchHandler.mockResolvedValue(userData)

      const store = new AppStore<TestDocumentTypes>(mockFetchHandler)
      const doc = store.findDoc('users', 1)

      expect(doc.isPending).toBe(true)
      expect(mockFetchHandler).toHaveBeenCalledWith('users', 1)

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(doc.content).toEqual(userData)
      expect(doc.isFulfilled).toBe(true)
    })

    it('should handle fetch handler errors', async () => {
      const mockFetchHandler = vi.fn()
      const errorMessage = 'Network error'

      mockFetchHandler.mockRejectedValue(new Error(errorMessage))

      const store = new AppStore<TestDocumentTypes>(mockFetchHandler)
      const doc = store.findDoc('users', 1)

      expect(doc.isPending).toBe(true)
      expect(mockFetchHandler).toHaveBeenCalledWith('users', 1)

      await new Promise(resolve => setTimeout(resolve, 0))

      expect(doc.content).toBeUndefined()
      expect(doc.isRejected).toBe(true)
    })

    it('should not call fetch handler for already fetched document', () => {
      const mockFetchHandler = vi.fn()
      const userData: User = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }

      const store = new AppStore<TestDocumentTypes>(mockFetchHandler)

      store.setDocument('users', 1, userData)
      const doc = store.findDoc('users', 1)

      expect(doc.content).toEqual(userData)
      expect(mockFetchHandler).not.toHaveBeenCalled()
    })
  })

  describe('insertDocument', () => {
    it('should insert a new document and mark as fulfilled', async () => {
      const store = new AppStore<TestDocumentTypes>()
      const newUser: Partial<User> & { id: number } = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }

      const doc = store.findDoc('users', 1)
      expect(doc.isPending).toBe(true) // Initially pending from findDoc

      const insertedUser = await store.insertDocument('users', newUser)

      expect(insertedUser).toEqual(newUser)
      expect(doc.content).toEqual(newUser)
      expect(doc.isFulfilled).toBe(true)
      expect(doc.isPending).toBe(false)
    })

    it('should show pending state during insertion', () => {
      const store = new AppStore<TestDocumentTypes>()
      const newUser: Partial<User> & { id: number } = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }

      const insertPromise = store.insertDocument('users', newUser)
      const doc = store.findDoc('users', 1)

      expect(doc.isPending).toBe(true)
      expect(doc.content).toBeUndefined()

      return insertPromise // Wait for completion
    })

    it('should allow inserting multiple documents of different types', async () => {
      const store = new AppStore<TestDocumentTypes>()

      const newUser: Partial<User> & { id: number } = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      }

      const newPost: Partial<Post> & { id: number } = {
        id: 1,
        title: 'Hello World',
        content: 'This is my first post',
        userId: 1,
        likes: 0,
      }

      const [insertedUser, insertedPost] = await Promise.all([
        store.insertDocument('users', newUser),
        store.insertDocument('posts', newPost),
      ])

      const userDoc = store.findDoc('users', 1)
      const postDoc = store.findDoc('posts', 1)

      expect(insertedUser).toEqual(newUser)
      expect(insertedPost).toEqual(newPost)
      expect(userDoc.content).toEqual(newUser)
      expect(postDoc.content).toEqual(newPost)
      expect(userDoc.isFulfilled).toBe(true)
      expect(postDoc.isFulfilled).toBe(true)
    })
  })
})
