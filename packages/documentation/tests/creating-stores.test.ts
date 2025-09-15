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
})
