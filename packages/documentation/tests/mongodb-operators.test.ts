/**
 * MongoDB-Style Operators Tests
 *
 * Tests the exact MongoDB-style operators examples from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'

describe('MongoDB-Style Operators Examples', () => {
  describe('Basic operations from Key Concepts', () => {
    it('should work exactly as shown in README', () => {
      const [state, update] = createStore({
        user: { name: 'John' },
        count: 0,
        items: ['oldItem', 'existingItem'],
        title: '',
        views: 0,
        tags: [],
      })

      // Set values
      update({ $set: { 'user.name': 'Jane' } })
      expect(state.user.name).toBe('Jane')

      // Increment numbers
      update({ $inc: { count: 1 } })
      expect(state.count).toBe(1)

      // Array operations
      update({ $push: { items: 'newItem' } })
      expect(state.items).toContain('newItem')

      update({ $pull: { items: 'oldItem' } })
      expect(state.items).not.toContain('oldItem')

      // Multiple operations (batched automatically)
      update({
        $set: { title: 'New Title' },
        $inc: { views: 1 },
        $push: { tags: 'featured' },
      })

      expect(state.title).toBe('New Title')
      expect(state.views).toBe(1)
      expect(state.tags).toContain('featured')
    })
  })

  describe('Detailed examples from Updating State section', () => {
    it('#DOC_TEST_5', () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: 'John', age: 30 },
        items: ['a', 'b', 'c'],
      })

      // Set values
      update({ $set: { count: 5 } })
      expect(state.count).toBe(5)

      update({ $set: { 'user.name': 'Jane' } }) // Dot notation for nested
      expect(state.user.name).toBe('Jane')

      // Increment numbers
      update({ $inc: { count: 1 } })
      expect(state.count).toBe(6)

      update({ $inc: { 'user.age': 5 } })
      expect(state.user.age).toBe(35)

      // Array operations
      update({ $push: { items: 'd' } })
      expect(state.items).toEqual(['a', 'b', 'c', 'd'])

      update({ $pull: { items: 'b' } })
      expect(state.items).toEqual(['a', 'c', 'd'])

      // Multiple operations in one call (batched)
      update({
        $set: { 'user.name': 'Bob' },
        $inc: { count: 2 },
        $push: { items: 'e' },
      })

      expect(state.user.name).toBe('Bob')
      expect(state.count).toBe(8)
      expect(state.items).toEqual(['a', 'c', 'd', 'e'])
    })
  })

  describe('$set - Set field values', () => {
    it('#DOC_TEST_11', () => {
      const [state, update] = createStore({
        count: 0,
        user: { name: 'John', age: 25 },
        settings: { theme: 'light' },
      })

      update({ $set: { count: 10 } })
      expect(state.count).toBe(10)

      update({ $set: { 'user.name': 'Alice' } }) // Nested with dot notation
      expect(state.user.name).toBe('Alice')

      update({
        $set: {
          'user.name': 'Bob',
          'user.age': 25,
          'settings.theme': 'dark',
        },
      })

      expect(state.user.name).toBe('Bob')
      expect(state.user.age).toBe(25)
      expect(state.settings.theme).toBe('dark')
    })
  })

  describe('$unset - Remove fields', () => {
    it('#DOC_TEST_12', () => {
      const [state, update] = createStore({
        temporaryField: 'temp',
        user: { middleName: 'Middle', name: 'John' },
      })

      update({ $unset: { temporaryField: 1 } })
      expect('temporaryField' in state).toBe(false)

      update({ $unset: { 'user.middleName': 1 } })
      expect('middleName' in state.user).toBe(false)
      expect(state.user.name).toBe('John') // Other fields remain
    })
  })

  describe('$inc - Increment numeric values', () => {
    it('#DOC_TEST_13', () => {
      const [state, update] = createStore({
        count: 0,
        stats: { views: 100 },
      })

      update({ $inc: { count: 1 } })
      expect(state.count).toBe(1)

      update({ $inc: { count: -5 } }) // Decrement
      expect(state.count).toBe(-4)

      update({ $inc: { 'stats.views': 10 } })
      expect(state.stats.views).toBe(110)
    })
  })

  describe('$push - Add to arrays', () => {
    it('#DOC_TEST_14', () => {
      const [state, update] = createStore({ items: ['existing'] })

      update({ $push: { items: 'newItem' } })
      expect(state.items).toContain('newItem')

      // Add multiple items with $each
      update({
        $push: {
          items: { $each: ['item1', 'item2', 'item3'] },
        },
      })

      expect(state.items).toContain('item1')
      expect(state.items).toContain('item2')
      expect(state.items).toContain('item3')
    })
  })

  describe('$pull - Remove from arrays', () => {
    it('#DOC_TEST_15', () => {
      const [state, update] = createStore({
        items: ['itemToRemove', 'keep'],
        users: [
          { id: 123, name: 'John' },
          { id: 456, name: 'Jane' },
        ],
      })

      // Remove by value
      update({ $pull: { items: 'itemToRemove' } })
      expect(state.items).not.toContain('itemToRemove')
      expect(state.items).toContain('keep')

      // Remove objects by matching properties
      update({
        $pull: {
          users: { id: 123, name: 'John' },
        },
      })

      expect(state.users.find(u => u.id === 123)).toBeUndefined()
      expect(state.users.find(u => u.id === 456)).toBeDefined()
    })
  })

  describe('$addToSet - Add unique elements to arrays', () => {
    it('#DOC_TEST_16', () => {
      const [state, update] = createStore({ tags: ['existing'] })

      update({ $addToSet: { tags: 'newTag' } }) // Won't add if already exists
      expect(state.tags).toContain('newTag')

      update({ $addToSet: { tags: 'existing' } }) // Should not duplicate
      expect(state.tags.filter(tag => tag === 'existing')).toHaveLength(1)

      // Add multiple unique items
      update({
        $addToSet: {
          tags: { $each: ['tag1', 'tag2', 'tag3'] },
        },
      })

      expect(state.tags).toContain('tag1')
      expect(state.tags).toContain('tag2')
      expect(state.tags).toContain('tag3')
    })
  })

  describe('$rename - Rename fields', () => {
    it('#DOC_TEST_17', () => {
      const [state, update] = createStore({
        oldFieldName: 'value',
        user: { firstName: 'John', lastName: 'Doe' },
      })

      update({ $rename: { oldFieldName: 'newFieldName' } })
      expect('oldFieldName' in state).toBe(false)
      expect(state.newFieldName).toBe('value')

      update({ $rename: { 'user.firstName': 'user.name' } })
      expect('firstName' in state.user).toBe(false)
      expect(state.user.name).toBe('John')
      expect(state.user.lastName).toBe('Doe')
    })
  })

  describe('$min/$max - Conditional updates', () => {
    it('#DOC_TEST_18', () => {
      const [state, update] = createStore({
        lowestScore: 100,
        highestScore: 50,
      })

      // Only updates if new value is smaller
      update({ $min: { lowestScore: 50 } })
      expect(state.lowestScore).toBe(50)

      // Only updates if new value is larger
      update({ $max: { highestScore: 100 } })
      expect(state.highestScore).toBe(100)
    })
  })
})
