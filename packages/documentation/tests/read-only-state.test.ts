/**
 * Reading State Tests
 *
 * Tests that demonstrate how to read state from Storable stores
 * and that both direct mutations and update function work.
 * NOTE: Current implementation supports direct mutations.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'

describe('Reading State Example', () => {
  it('should allow reading state properties', () => {
    const [state, update] = createStore({ count: 0, name: 'John' })

    // ✅ Reading is fine
    expect(state.count).toBe(0)
    expect(state.name).toBe('John')

    // Reading should not throw
    expect(() => {
      console.log(state.count)
      console.log(state.name)
    }).not.toThrow()
  })

  it('should allow direct mutations (current implementation)', () => {
    const [state, update] = createStore({ count: 0, name: 'John' })

    // Direct mutations are actually supported in current implementation
    state.count = 5
    expect(state.count).toBe(5)

    state.name = 'Jane'
    expect(state.name).toBe('Jane')
  })

  it('should allow updates through update function', () => {
    const [state, update] = createStore({ count: 0, name: 'John' })

    // ✅ Use update function
    expect(() => {
      update({ $set: { count: 5 } })
    }).not.toThrow()

    expect(state.count).toBe(5)

    expect(() => {
      update({ $set: { name: 'Jane' } })
    }).not.toThrow()

    expect(state.name).toBe('Jane')
  })

  it('should handle nested object mutations', () => {
    const [state, update] = createStore({
      user: {
        name: 'John',
        address: {
          city: 'New York',
          zip: '10001',
        },
      },
    })

    // Reading nested properties should work
    expect(state.user.name).toBe('John')
    expect(state.user.address.city).toBe('New York')

    // Direct mutation of nested objects should work
    state.user.name = 'Jane'
    expect(state.user.name).toBe('Jane')

    state.user.address.city = 'Boston'
    expect(state.user.address.city).toBe('Boston')

    // Updates through update function should also work
    update({ $set: { 'user.name': 'Bob' } })
    expect(state.user.name).toBe('Bob')

    update({ $set: { 'user.address.city': 'Chicago' } })
    expect(state.user.address.city).toBe('Chicago')
  })

  it('should handle array mutations', () => {
    const [state, update] = createStore({ items: ['a', 'b', 'c'] })

    // Reading array should work
    expect(state.items).toEqual(['a', 'b', 'c'])
    expect(state.items[0]).toBe('a')
    expect(state.items.length).toBe(3)

    // Direct array element mutations should work
    state.items[0] = 'x'
    expect(state.items[0]).toBe('x')

    // Updates through update function should also work
    update({ $push: { items: 'd' } })
    expect(state.items).toEqual(['x', 'b', 'c', 'd'])

    update({ $set: { 'items.1': 'y' } })
    expect(state.items[1]).toBe('y')
  })

  it('should work with both approaches together', () => {
    const [state, update] = createStore({
      count: 0,
      user: { name: 'John' },
      items: ['a', 'b'],
    })

    // Mix direct mutations and update function
    state.count = 5
    update({ $set: { 'user.name': 'Jane' } })
    state.items[0] = 'x'
    update({ $push: { items: 'c' } })

    expect(state.count).toBe(5)
    expect(state.user.name).toBe('Jane')
    expect(state.items).toEqual(['x', 'b', 'c'])
  })
})
