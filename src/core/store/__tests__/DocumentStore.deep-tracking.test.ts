import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentStore, update } from '../DocumentStore'
import type { Document } from '../../types'

interface TestUser extends Document {
  name: string
  email: string
  profile: {
    settings: {
      theme: 'light' | 'dark'
      notifications: {
        email: boolean
        push: boolean
      }
    }
    bio: string
  }
  tags: string[]
}

describe('DocumentStore - Type Safety & Deep Tracking', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('type-safe document access', () => {
    it('should provide type-safe access to documents with proper TypeScript generics', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'dark',
            notifications: {
              email: true,
              push: false,
            },
          },
          bio: 'A developer',
        },
        tags: ['developer', 'typescript'],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      // Type checking should work at compile time
      expect(signal.value?.name).toBe('John Doe')
      expect(signal.value?.profile.settings.theme).toBe('dark')
      expect(signal.value?.profile.settings.notifications.email).toBe(true)
      expect(signal.value?.tags).toEqual(['developer', 'typescript'])
    })

    it('should support direct store access with type safety', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'light',
            notifications: {
              email: false,
              push: true,
            },
          },
          bio: 'Another developer',
        },
        tags: ['react', 'vue'],
      }

      store.setDocument('user', 'user1', user)

      // Direct access should maintain type safety
      const directUser = store.getDocument<TestUser>('user', 'user1')
      expect(directUser?.profile.settings.theme).toBe('light')
      expect(directUser?.profile.settings.notifications.push).toBe(true)
    })
  })

  describe('deep nested field change detection', () => {
    it('should detect changes to deeply nested fields and trigger signal updates', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'light',
            notifications: {
              email: true,
              push: false,
            },
          },
          bio: 'A developer',
        },
        tags: ['developer'],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')
      const mockCallback = vi.fn()

      signal.subscribe(mockCallback)

      // Update deeply nested field
      const deepSignal = store.getDeepSignal('user', 'user1')
      update(
        deepSignal,
        [{ op: '$set', path: 'profile.settings.theme', value: 'dark' }],
        store,
        'user',
        'user1'
      )

      expect(signal.value?.profile.settings.theme).toBe('dark')
      expect(mockCallback).toHaveBeenCalled()
    })

    it('should detect changes to nested object properties', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'light',
            notifications: {
              email: true,
              push: false,
            },
          },
          bio: 'A developer',
        },
        tags: ['developer'],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      // Update nested notification setting
      const deepSignal = store.getDeepSignal('user', 'user1')
      update(
        deepSignal,
        [
          {
            op: '$set',
            path: 'profile.settings.notifications.push',
            value: true,
          },
        ],
        store,
        'user',
        'user1'
      )

      expect(signal.value?.profile.settings.notifications.push).toBe(true)
      expect(signal.value?.profile.settings.notifications.email).toBe(true) // Should remain unchanged
    })

    it('should detect changes to array elements', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'light',
            notifications: {
              email: true,
              push: false,
            },
          },
          bio: 'A developer',
        },
        tags: ['developer', 'typescript'],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      // Update array field
      const deepSignal = store.getDeepSignal('user', 'user1')
      update(
        deepSignal,
        [
          {
            op: '$set',
            path: 'tags',
            value: ['developer', 'typescript', 'react'],
          },
        ],
        store,
        'user',
        'user1'
      )

      expect(signal.value?.tags).toEqual(['developer', 'typescript', 'react'])
    })

    it('should handle creating new nested paths that do not exist', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'light',
            notifications: {
              email: true,
              push: false,
            },
          },
          bio: 'A developer',
        },
        tags: ['developer'],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')

      // Update bio field
      const deepSignal = store.getDeepSignal('user', 'user1')
      update(
        deepSignal,
        [{ op: '$set', path: 'profile.bio', value: 'Updated bio text' }],
        store,
        'user',
        'user1'
      )

      expect(signal.value?.profile.bio).toBe('Updated bio text')
    })

    it('should trigger granular updates for specific field changes', () => {
      const user: TestUser = {
        id: 'user1',
        name: 'John Doe',
        email: 'john@example.com',
        profile: {
          settings: {
            theme: 'light',
            notifications: {
              email: true,
              push: false,
            },
          },
          bio: 'A developer',
        },
        tags: ['developer'],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal<TestUser>('user', 'user1')
      const mockCallback = vi.fn()

      signal.subscribe(mockCallback)

      // Multiple nested updates should all trigger signals
      const deepSignal = store.getDeepSignal('user', 'user1')
      update(
        deepSignal,
        [{ op: '$set', path: 'name', value: 'Jane Doe' }],
        store,
        'user',
        'user1'
      )

      update(
        deepSignal,
        [{ op: '$set', path: 'profile.settings.theme', value: 'dark' }],
        store,
        'user',
        'user1'
      )

      update(
        deepSignal,
        [
          {
            op: '$set',
            path: 'profile.settings.notifications.email',
            value: false,
          },
        ],
        store,
        'user',
        'user1'
      )

      expect(signal.value?.name).toBe('Jane Doe')
      expect(signal.value?.profile.settings.theme).toBe('dark')
      expect(signal.value?.profile.settings.notifications.email).toBe(false)
      expect(mockCallback).toHaveBeenCalledTimes(3)
    })
  })
})
