/**
 * MongoDB-Style Operators Tests
 *
 * Tests all the MongoDB-style operators documented in the README
 * to ensure they work as documented.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'

describe('MongoDB-Style Operators Examples', () => {
  describe('$set - Set field values', () => {
    it('should set simple field values', () => {
      const [state, update] = createStore({ count: 0, name: 'John' })

      update({ $set: { count: 10 } })
      expect(state.count).toBe(10)

      update({ $set: { name: 'Alice' } })
      expect(state.name).toBe('Alice')
    })

    it('should set nested field values with dot notation', () => {
      const [state, update] = createStore({
        user: { name: 'John', age: 30 },
        settings: { theme: 'light', notifications: { email: true } },
      })

      update({ $set: { 'user.name': 'Alice' } })
      expect(state.user.name).toBe('Alice')

      update({ $set: { 'settings.theme': 'dark' } })
      expect(state.settings.theme).toBe('dark')

      update({ $set: { 'settings.notifications.email': false } })
      expect(state.settings.notifications.email).toBe(false)
    })

    it('should set multiple fields at once', () => {
      const [state, update] = createStore({
        user: { name: 'John', age: 30 },
        settings: { theme: 'light' },
      })

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
    it('should remove fields', () => {
      const [state, update] = createStore({
        count: 5,
        name: 'John',
        temporaryField: 'temp',
      })

      update({ $unset: { temporaryField: 1 } })
      expect('temporaryField' in state).toBe(false)
      expect(state.count).toBe(5) // Other fields should remain
      expect(state.name).toBe('John')
    })

    it('should remove nested fields', () => {
      const [state, update] = createStore({
        user: { name: 'John', middleName: 'Doe', age: 30 },
      })

      update({ $unset: { 'user.middleName': 1 } })
      expect('middleName' in state.user).toBe(false)
      expect(state.user.name).toBe('John')
      expect(state.user.age).toBe(30)
    })
  })

  describe('$inc - Increment numeric values', () => {
    it('should increment simple numeric values', () => {
      const [state, update] = createStore({ count: 5, score: 10 })

      update({ $inc: { count: 1 } })
      expect(state.count).toBe(6)

      update({ $inc: { score: 5 } })
      expect(state.score).toBe(15)
    })

    it('should decrement with negative values', () => {
      const [state, update] = createStore({ count: 10 })

      update({ $inc: { count: -5 } })
      expect(state.count).toBe(5)
    })

    it('should increment nested numeric values', () => {
      const [state, update] = createStore({
        stats: { views: 100, likes: 50 },
        user: { age: 25 },
      })

      update({ $inc: { 'stats.views': 10 } })
      expect(state.stats.views).toBe(110)

      update({ $inc: { 'user.age': 1 } })
      expect(state.user.age).toBe(26)
    })

    it('should handle multiple increments', () => {
      const [state, update] = createStore({
        count: 0,
        score: 100,
        nested: { value: 50 },
      })

      update({
        $inc: {
          count: 5,
          score: -10,
          'nested.value': 25,
        },
      })

      expect(state.count).toBe(5)
      expect(state.score).toBe(90)
      expect(state.nested.value).toBe(75)
    })
  })

  describe('$push - Add to arrays', () => {
    it('should add single items to arrays', () => {
      const [state, update] = createStore({ items: ['a', 'b'] })

      update({ $push: { items: 'c' } })
      expect(state.items).toEqual(['a', 'b', 'c'])

      update({ $push: { items: 'newItem' } })
      expect(state.items).toEqual(['a', 'b', 'c', 'newItem'])
    })

    it('should add multiple items with $each', () => {
      const [state, update] = createStore({ items: ['a'] })

      update({
        $push: {
          items: { $each: ['item1', 'item2', 'item3'] },
        },
      })

      expect(state.items).toEqual(['a', 'item1', 'item2', 'item3'])
    })

    it('should add objects to arrays', () => {
      const [state, update] = createStore({
        users: [{ id: 1, name: 'Alice' }],
        todos: [],
      })

      update({ $push: { users: { id: 2, name: 'Bob' } } })
      expect(state.users).toHaveLength(2)
      expect(state.users[1]).toEqual({ id: 2, name: 'Bob' })

      update({
        $push: { todos: { id: 1, text: 'Test todo', completed: false } },
      })
      expect(state.todos).toHaveLength(1)
      expect(state.todos[0]).toEqual({
        id: 1,
        text: 'Test todo',
        completed: false,
      })
    })

    it('should add to nested arrays', () => {
      const [state, update] = createStore({
        data: {
          tags: ['tag1'],
          categories: [],
        },
      })

      update({ $push: { 'data.tags': 'tag2' } })
      expect(state.data.tags).toEqual(['tag1', 'tag2'])

      update({ $push: { 'data.categories': 'category1' } })
      expect(state.data.categories).toEqual(['category1'])
    })
  })

  describe('$pull - Remove from arrays', () => {
    it('should remove items by value', () => {
      const [state, update] = createStore({ items: ['a', 'b', 'c', 'b'] })

      update({ $pull: { items: 'b' } })
      // Should remove all instances of 'b'
      expect(state.items).toEqual(['a', 'c'])
    })

    it('should remove objects by matching properties', () => {
      const [state, update] = createStore({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
      })

      update({
        $pull: {
          users: { id: 2, name: 'Bob' },
        },
      })

      expect(state.users).toHaveLength(2)
      expect(state.users.find(u => u.id === 2)).toBeUndefined()
      expect(state.users.find(u => u.id === 1)).toBeDefined()
      expect(state.users.find(u => u.id === 3)).toBeDefined()
    })

    it('should remove from nested arrays', () => {
      const [state, update] = createStore({
        data: {
          tags: ['tag1', 'tag2', 'tag3'],
          items: ['item1', 'item2'],
        },
      })

      update({ $pull: { 'data.tags': 'tag2' } })
      expect(state.data.tags).toEqual(['tag1', 'tag3'])

      update({ $pull: { 'data.items': 'item1' } })
      expect(state.data.items).toEqual(['item2'])
    })
  })

  describe('$addToSet - Add unique elements to arrays', () => {
    it('should add unique elements only', () => {
      const [state, update] = createStore({ tags: ['tag1', 'tag2'] })

      update({ $addToSet: { tags: 'tag3' } })
      expect(state.tags).toEqual(['tag1', 'tag2', 'tag3'])

      // Should not add duplicate
      update({ $addToSet: { tags: 'tag2' } })
      expect(state.tags).toEqual(['tag1', 'tag2', 'tag3'])
    })

    it('should add multiple unique items with $each', () => {
      const [state, update] = createStore({ tags: ['tag1'] })

      update({
        $addToSet: {
          tags: { $each: ['tag2', 'tag3', 'tag1'] }, // tag1 already exists
        },
      })

      expect(state.tags).toEqual(['tag1', 'tag2', 'tag3'])
    })
  })

  describe('$rename - Rename fields', () => {
    it('should rename simple fields', () => {
      const [state, update] = createStore({
        oldFieldName: 'value',
        otherField: 'keep',
      })

      update({ $rename: { oldFieldName: 'newFieldName' } })
      expect('oldFieldName' in state).toBe(false)
      expect(state.newFieldName).toBe('value')
      expect(state.otherField).toBe('keep')
    })

    it('should rename nested fields', () => {
      const [state, update] = createStore({
        user: { firstName: 'John', lastName: 'Doe' },
        other: 'value',
      })

      update({ $rename: { 'user.firstName': 'user.name' } })
      expect('firstName' in state.user).toBe(false)
      expect(state.user.name).toBe('John')
      expect(state.user.lastName).toBe('Doe')
      expect(state.other).toBe('value')
    })
  })

  describe('$min/$max - Conditional updates', () => {
    it('should update with $min only if new value is smaller', () => {
      const [state, update] = createStore({ lowestScore: 100 })

      // Should update because 50 < 100
      update({ $min: { lowestScore: 50 } })
      expect(state.lowestScore).toBe(50)

      // Should not update because 75 > 50
      update({ $min: { lowestScore: 75 } })
      expect(state.lowestScore).toBe(50)

      // Should update because 25 < 50
      update({ $min: { lowestScore: 25 } })
      expect(state.lowestScore).toBe(25)
    })

    it('should update with $max only if new value is larger', () => {
      const [state, update] = createStore({ highestScore: 50 })

      // Should update because 100 > 50
      update({ $max: { highestScore: 100 } })
      expect(state.highestScore).toBe(100)

      // Should not update because 75 < 100
      update({ $max: { highestScore: 75 } })
      expect(state.highestScore).toBe(100)

      // Should update because 150 > 100
      update({ $max: { highestScore: 150 } })
      expect(state.highestScore).toBe(150)
    })

    it('should handle nested min/max operations', () => {
      const [state, update] = createStore({
        stats: { min: 10, max: 90 },
      })

      update({ $min: { 'stats.min': 5 } })
      expect(state.stats.min).toBe(5)

      update({ $min: { 'stats.min': 15 } }) // Should not update
      expect(state.stats.min).toBe(5)

      update({ $max: { 'stats.max': 100 } })
      expect(state.stats.max).toBe(100)

      update({ $max: { 'stats.max': 80 } }) // Should not update
      expect(state.stats.max).toBe(100)
    })
  })

  describe('Multiple operations in one call (batched)', () => {
    it('should handle multiple operations together', () => {
      const [state, update] = createStore({
        user: { name: 'John', age: 30 },
        count: 0,
        items: ['a', 'b'],
        tags: ['tag1'],
      })

      // Multiple operations in one call (batched)
      update({
        $set: { 'user.name': 'Bob' },
        $inc: { count: 2 },
        $push: { items: 'e' },
      })

      expect(state.user.name).toBe('Bob')
      expect(state.count).toBe(2)
      expect(state.items).toEqual(['a', 'b', 'e'])
      expect(state.user.age).toBe(30) // Unchanged
    })

    it('should handle complex batched operations', () => {
      const [state, update] = createStore({
        user: { name: 'Alice', score: 100, tags: ['beginner'] },
        stats: { views: 50, min: 10, max: 200 },
        items: ['x', 'y'],
        oldField: 'value',
      })

      update({
        $set: { 'user.name': 'Bob', 'stats.views': 100 },
        $inc: { 'user.score': 50 },
        $push: { 'user.tags': 'advanced', items: 'z' },
        $min: { 'stats.min': 5 },
        $max: { 'stats.max': 250 },
        $rename: { oldField: 'newField' },
      })

      expect(state.user.name).toBe('Bob')
      expect(state.user.score).toBe(150)
      expect(state.user.tags).toEqual(['beginner', 'advanced'])
      expect(state.stats.views).toBe(100)
      expect(state.stats.min).toBe(5)
      expect(state.stats.max).toBe(250)
      expect(state.items).toEqual(['x', 'y', 'z'])
      expect(state.newField).toBe('value')
      expect('oldField' in state).toBe(false)
    })
  })
})
