/**
 * TypeScript Tests
 *
 * Tests the exact TypeScript examples from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'
import { render, screen } from '@testing-library/react'

describe('TypeScript Examples', () => {
  it('#DOC_TEST_27', () => {
    interface AppState {
      user: {
        name: string
        age: number
        preferences: {
          theme: 'light' | 'dark'
          notifications: boolean
        }
      }
      items: Array<{ id: string; title: string; count: number }>
    }

    const [store, update] = createStore<AppState>({
      user: {
        name: 'John',
        age: 30,
        preferences: {
          theme: 'light',
          notifications: true,
        },
      },
      items: [],
    })

    // TypeScript will enforce correct types in updates
    update({
      $set: {
        'user.name': 'Jane', // ✅ string
        // 'user.age': 'invalid'    // ❌ TypeScript error - must be number
      },
      $push: {
        items: {
          id: '1',
          title: 'Item 1',
          count: 5, // ✅ All required fields
        },
      },
    })

    expect(store.user.name).toBe('Jane')
    expect(store.items).toHaveLength(1)
    expect(store.items[0]).toEqual({
      id: '1',
      title: 'Item 1',
      count: 5,
    })

    // Component usage is also type-safe
    function UserProfile() {
      const state = useTrackedStore(store)

      return (
        <div>
          <h1>{state.user.name}</h1>
          <p>Age: {state.user.age}</p>
        </div>
      )
    }

    // Test the component
    render(<UserProfile />)

    expect(screen.getByText('Jane')).toBeInTheDocument()
    expect(screen.getByText('Age: 30')).toBeInTheDocument()
  })
})
