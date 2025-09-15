/**
 * App Store Tests
 *
 * Tests the exact App Store examples from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppStore } from '@storable/app-store'

describe('App Store Examples', () => {
  describe('Basic Setup and Document Types', () => {
    it('should create AppStore with fetch handler exactly as shown in README', async () => {
      // Define your document types
      interface DocumentTypes {
        users: {
          id: number
          firstName: string
          lastName: string
          email: string
        }
        posts: { id: number; title: string; content: string; userId: number }
      }

      // Create app store with optional fetch handler
      const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
        const response = await fetch(`/api/${modelType}/${id}`)
        return response.json()
      })

      // Basic assertions
      expect(appStore).toBeInstanceOf(AppStore)
      expect(typeof appStore.findDoc).toBe('function')
      expect(typeof appStore.setDocument).toBe('function')
    })

    it('should create AppStore without fetch handler exactly as shown in README', () => {
      interface DocumentTypes {
        users: {
          id: number
          firstName: string
          lastName: string
          email: string
        }
        posts: { id: number; title: string; content: string; userId: number }
      }

      // Without fetch handler (manual data management)
      const appStore = new AppStore<DocumentTypes>()

      expect(appStore).toBeInstanceOf(AppStore)
    })
  })

  describe('Finding Documents', () => {
    it('should handle document states exactly as shown in README', () => {
      interface DocumentTypes {
        posts: {
          id: number
          title: string
          content: string
          userId: number
          likes: number
        }
        users: { id: number; firstName: string; lastName: string }
      }

      const appStore = new AppStore<DocumentTypes>()

      const doc = appStore.findDoc('posts', 1)

      // Document States - Documents have a promise-like API with these properties:
      expect(typeof doc.content).toBe('undefined') // T | undefined - The document data
      expect(doc.isPending).toBe(false) // boolean - Request in progress (false without fetch handler)
      expect(doc.isSettled).toBe(false) // boolean - Request completed (success or failure)
      expect(doc.isRejected).toBe(false) // boolean - Request failed
      expect(doc.isFulfilled).toBe(false) // boolean - Request succeeded
    })
  })

  describe('Manual Document Management', () => {
    it('should work exactly as shown in README', () => {
      interface DocumentTypes {
        users: {
          id: number
          firstName: string
          lastName: string
          email: string
        }
      }

      const appStore = new AppStore<DocumentTypes>()

      // Set document directly
      appStore.setDocument('users', 1, {
        id: 1,
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
      })

      const user = appStore.findDoc('users', 1)
      expect(user.isFulfilled).toBe(true)
      expect(user.content).toEqual({
        id: 1,
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
      })

      // Handle errors
      appStore.setDocumentError('users', 999, 'User not found')
      const errorUser = appStore.findDoc('users', 999)
      expect(errorUser.isRejected).toBe(true)
    })
  })

  describe('Inserting Documents', () => {
    it('should work exactly as shown in README', async () => {
      interface DocumentTypes {
        users: {
          id: number
          firstName: string
          lastName: string
          email: string
        }
      }

      const appStore = new AppStore<DocumentTypes>()

      // Shows as pending immediately, then fulfilled when complete
      const newUserPromise = appStore.insertDocument('users', {
        id: 123,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })

      // Document is immediately available to other components
      const user = appStore.findDoc('users', 123)
      expect(user.isPending).toBe(true) // Initially pending

      const newUser = await newUserPromise
      expect(newUser).toEqual({
        id: 123,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      })

      // Now should be fulfilled
      expect(user.isFulfilled).toBe(true)
      expect(user.content).toEqual(newUser)
    })
  })

  describe('Document-Oriented App Store integration example', () => {
    it('should work exactly as shown in README', () => {
      // For app-level document management with a promise-like API:
      interface DocumentTypes {
        users: {
          id: number
          firstName: string
          lastName: string
          email: string
        }
        posts: { id: number; title: string; content: string; userId: number }
      }

      // Create app store with optional fetch handler
      const appStore = new AppStore<DocumentTypes>(async (modelType, id) => {
        const response = await fetch(`/api/${modelType}/${id}`)
        return response.json()
      })

      function MyComponent() {
        // Documents are fetched automatically and cached
        const post = appStore.findDoc('posts', 1)
        const user = appStore.findDoc('users', post.content?.userId)

        if (post.isPending) return <div>Loading post...</div>
        if (post.isRejected) return <div>Error loading post</div>

        return (
          <article>
            <h1>{post.content?.title}</h1>
            {user.content && (
              <p>
                By: {user.content.firstName} {user.content.lastName}
              </p>
            )}
          </article>
        )
      }

      // Set up some test data
      appStore.setDocument('posts', 1, {
        id: 1,
        title: 'Test Post',
        content: 'This is a test',
        userId: 2,
      })

      appStore.setDocument('users', 2, {
        id: 2,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
      })

      render(<MyComponent />)

      expect(screen.getByText('Test Post')).toBeInTheDocument()
      expect(screen.getByText('By: Jane Doe')).toBeInTheDocument()
    })

    it('should handle loading and error states exactly as shown in README', () => {
      interface DocumentTypes {
        posts: { id: number; title: string; content: string; userId: number }
      }

      const appStore = new AppStore<DocumentTypes>()

      function MyComponent() {
        const post = appStore.findDoc('posts', 1)

        if (post.isPending) return <div>Loading post...</div>
        if (post.isRejected) return <div>Error loading post</div>

        return (
          <article>
            <h1>{post.content?.title}</h1>
          </article>
        )
      }

      // Test default state (without fetch handler, document is not pending)
      render(<MyComponent />)
      // Without content, renders empty article with empty h1
      expect(screen.getByRole('article')).toBeInTheDocument()

      // Test error state - component doesn't auto re-render, need to render fresh
      appStore.setDocumentError('posts', 1, 'Post not found')

      // Re-render component to see error state
      render(<MyComponent />)
      expect(screen.getByText('Error loading post')).toBeInTheDocument()
    })
  })
})
