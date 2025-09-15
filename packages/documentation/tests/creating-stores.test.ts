/**
 * Creating Stores Tests
 *
 * Tests the examples for creating stores with different initial state structures.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'

describe('Creating Stores Examples', () => {
  it('should create a simple store', () => {
    // Simple store
    const [state, update] = createStore({
      count: 0,
      name: 'John',
    })

    expect(state.count).toBe(0)
    expect(state.name).toBe('John')

    // Should have update function
    expect(typeof update).toBe('function')

    // Should be able to update
    update({ $set: { count: 5 } })
    expect(state.count).toBe(5)

    update({ $set: { name: 'Jane' } })
    expect(state.name).toBe('Jane')
  })

  it('should create a store with nested objects', () => {
    // With nested objects
    const [state, update] = createStore({
      user: {
        name: 'Alice',
        address: {
          city: 'New York',
          zip: '10001',
        },
      },
      todos: [],
    })

    // Test initial nested state
    expect(state.user.name).toBe('Alice')
    expect(state.user.address.city).toBe('New York')
    expect(state.user.address.zip).toBe('10001')
    expect(state.todos).toEqual([])

    // Test nested updates
    update({ $set: { 'user.name': 'Bob' } })
    expect(state.user.name).toBe('Bob')

    update({ $set: { 'user.address.city': 'Boston' } })
    expect(state.user.address.city).toBe('Boston')

    update({ $set: { 'user.address.zip': '02101' } })
    expect(state.user.address.zip).toBe('02101')

    // Test array updates
    update({ $push: { todos: { id: 1, text: 'Test todo' } } })
    expect(state.todos).toHaveLength(1)
    expect(state.todos[0]).toEqual({ id: 1, text: 'Test todo' })
  })

  it('should handle complex nested structures', () => {
    const [state, update] = createStore({
      app: {
        settings: {
          theme: 'light',
          notifications: {
            email: true,
            push: false,
            sound: {
              enabled: true,
              volume: 0.8,
            },
          },
        },
        data: {
          users: [],
          posts: [],
          comments: {},
        },
      },
      ui: {
        loading: false,
        errors: [],
        modals: {
          login: false,
          settings: false,
        },
      },
    })

    // Test deeply nested reads
    expect(state.app.settings.theme).toBe('light')
    expect(state.app.settings.notifications.email).toBe(true)
    expect(state.app.settings.notifications.sound.volume).toBe(0.8)
    expect(state.ui.loading).toBe(false)
    expect(state.ui.modals.login).toBe(false)

    // Test deeply nested updates
    update({ $set: { 'app.settings.theme': 'dark' } })
    expect(state.app.settings.theme).toBe('dark')

    update({ $set: { 'app.settings.notifications.push': true } })
    expect(state.app.settings.notifications.push).toBe(true)

    update({ $set: { 'app.settings.notifications.sound.volume': 0.5 } })
    expect(state.app.settings.notifications.sound.volume).toBe(0.5)

    update({ $set: { 'ui.loading': true } })
    expect(state.ui.loading).toBe(true)

    update({ $set: { 'ui.modals.login': true } })
    expect(state.ui.modals.login).toBe(true)

    // Test array operations in nested structure
    update({ $push: { 'app.data.users': { id: 1, name: 'Alice' } } })
    expect(state.app.data.users).toHaveLength(1)
    expect(state.app.data.users[0]).toEqual({ id: 1, name: 'Alice' })

    update({ $push: { 'ui.errors': 'Network error' } })
    expect(state.ui.errors).toEqual(['Network error'])
  })

  it('should handle updates correctly', () => {
    const [state, update] = createStore({
      user: { name: 'Alice', age: 30 },
      settings: { theme: 'light' },
      count: 0,
    })

    // Test that updates work correctly
    update({ $set: { count: 1 } })
    expect(state.count).toBe(1)

    // Test nested updates
    update({ $set: { 'user.name': 'Bob' } })
    expect(state.user.name).toBe('Bob')
    expect(state.user.age).toBe(30) // Should remain unchanged

    // Test that other objects remain unchanged
    expect(state.settings.theme).toBe('light')
  })
})
