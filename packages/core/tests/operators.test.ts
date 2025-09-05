import { describe, it, expect, beforeEach } from 'vitest'
import { createStore, update, type UpdateOperations } from '../src'
import { effect } from 'alien-signals'

describe('MongoDB Update Operators', () => {
  describe('$set operator', () => {
    it('should set top-level properties', () => {
      const [state] = createStore({ name: 'John', age: 30 })
      update(state, {
        $set: { name: 'Jane', age: 25 },
      })
      expect(state.name).toBe('Jane')
      expect(state.age).toBe(25)
    })

    it('should set nested properties with dot notation', () => {
      const [state] = createStore({
        user: { name: 'John', address: { city: 'NYC' } },
      })
      update(state, {
        $set: {
          'user.name': 'Jane',
          'user.address.city': 'LA',
        },
      })
      expect(state.user.name).toBe('Jane')
      expect(state.user.address.city).toBe('LA')
    })

    it('should create intermediate objects when setting nested paths', () => {
      const [state] = createStore<any>({})
      update(state, {
        $set: {
          'user.profile.bio': 'Hello',
        },
      })
      expect(state.user).toBeDefined()
      expect(state.user.profile).toBeDefined()
      expect(state.user.profile.bio).toBe('Hello')
    })

    it('should set array elements by index', () => {
      const [state] = createStore({ items: ['a', 'b', 'c'] })
      update(state, {
        $set: { 'items.1': 'modified' },
      })
      expect(state.items[1]).toBe('modified')
      expect(state.items).toEqual(['a', 'modified', 'c'])
    })

    it('should trigger reactivity', () => {
      const [state] = createStore({ count: 0 })
      let effectCount = 0
      effect(() => {
        state.count // Access to create dependency
        effectCount++
      })
      expect(effectCount).toBe(1)

      update(state, { $set: { count: 5 } })
      expect(effectCount).toBe(2)
      expect(state.count).toBe(5)
    })
  })

  describe('$unset operator', () => {
    it('should remove top-level properties', () => {
      const [state] = createStore<any>({ a: 1, b: 2, c: 3 })
      update(state, {
        $unset: { b: true },
      })
      expect(state.a).toBe(1)
      expect(state.b).toBeUndefined()
      expect(state.c).toBe(3)
      expect('b' in state).toBe(false)
    })

    it('should remove nested properties with dot notation', () => {
      const [state] = createStore<any>({
        user: { name: 'John', age: 30, email: 'john@example.com' },
      })
      update(state, {
        $unset: { 'user.email': true },
      })
      expect(state.user.name).toBe('John')
      expect(state.user.age).toBe(30)
      expect(state.user.email).toBeUndefined()
      expect('email' in state.user).toBe(false)
    })

    it('should handle array elements (set to undefined)', () => {
      const [state] = createStore({ items: ['a', 'b', 'c'] })
      update(state, {
        $unset: { 'items.1': true },
      })
      expect(state.items[1]).toBeUndefined()
      expect(state.items.length).toBe(3) // Length preserved
      expect(state.items).toEqual(['a', undefined, 'c'])
    })
  })

  describe('$inc operator', () => {
    it('should increment numeric fields', () => {
      const [state] = createStore({ count: 10 })
      update(state, {
        $inc: { count: 5 },
      })
      expect(state.count).toBe(15)
    })

    it('should decrement with negative values', () => {
      const [state] = createStore({ count: 10 })
      update(state, {
        $inc: { count: -3 },
      })
      expect(state.count).toBe(7)
    })

    it('should handle nested numeric fields', () => {
      const [state] = createStore({
        stats: { views: 100, likes: 50 },
      })
      update(state, {
        $inc: {
          'stats.views': 10,
          'stats.likes': -5,
        },
      })
      expect(state.stats.views).toBe(110)
      expect(state.stats.likes).toBe(45)
    })

    it('should treat undefined as 0', () => {
      const [state] = createStore<any>({})
      update(state, {
        $inc: { count: 5 },
      })
      expect(state.count).toBe(5)
    })

    it('should trigger reactivity once for multiple increments', () => {
      const [state] = createStore({ a: 1, b: 2 })
      let effectCount = 0
      effect(() => {
        state.a + state.b // Access both
        effectCount++
      })
      expect(effectCount).toBe(1)

      update(state, {
        $inc: { a: 10, b: 20 },
      })
      expect(effectCount).toBe(2) // Should batch updates
      expect(state.a).toBe(11)
      expect(state.b).toBe(22)
    })
  })

  describe('$mul operator', () => {
    it('should multiply numeric fields', () => {
      const [state] = createStore({ price: 100 })
      update(state, {
        $mul: { price: 0.9 }, // 10% discount
      })
      expect(state.price).toBe(90)
    })

    it('should handle nested fields', () => {
      const [state] = createStore({
        product: { price: 50, quantity: 2 },
      })
      update(state, {
        $mul: {
          'product.price': 1.2,
          'product.quantity': 3,
        },
      })
      expect(state.product.price).toBe(60)
      expect(state.product.quantity).toBe(6)
    })

    it('should treat undefined as 0', () => {
      const [state] = createStore<any>({})
      update(state, {
        $mul: { value: 10 },
      })
      expect(state.value).toBe(0)
    })
  })

  describe('$push operator', () => {
    it('should add single element to array', () => {
      const [state] = createStore({ items: ['a', 'b'] })
      update(state, {
        $push: { items: 'c' },
      })
      expect(state.items).toEqual(['a', 'b', 'c'])
    })

    it('should create array if it does not exist', () => {
      const [state] = createStore<any>({})
      update(state, {
        $push: { items: 'first' },
      })
      expect(state.items).toEqual(['first'])
    })

    it('should push to nested arrays', () => {
      const [state] = createStore({
        user: { tags: ['tag1'] },
      })
      update(state, {
        $push: { 'user.tags': 'tag2' },
      })
      expect(state.user.tags).toEqual(['tag1', 'tag2'])
    })

    it('should support $each modifier', () => {
      const [state] = createStore({ items: ['a'] })
      update(state, {
        $push: {
          items: { $each: ['b', 'c', 'd'] },
        },
      })
      expect(state.items).toEqual(['a', 'b', 'c', 'd'])
    })

    it('should support $position modifier', () => {
      const [state] = createStore({ items: ['a', 'c', 'd'] })
      update(state, {
        $push: {
          items: { $each: ['b'], $position: 1 },
        },
      })
      expect(state.items).toEqual(['a', 'b', 'c', 'd'])
    })

    it('should support $slice modifier to limit array size', () => {
      const [state] = createStore({ items: ['a', 'b'] })
      update(state, {
        $push: {
          items: { $each: ['c', 'd', 'e'], $slice: 3 },
        },
      })
      expect(state.items).toEqual(['a', 'b', 'c'])
    })

    it('should support negative $slice to keep last N elements', () => {
      const [state] = createStore({ items: ['a', 'b'] })
      update(state, {
        $push: {
          items: { $each: ['c', 'd', 'e'], $slice: -3 },
        },
      })
      expect(state.items).toEqual(['c', 'd', 'e'])
    })

    it('should support $sort modifier', () => {
      const [state] = createStore({ numbers: [3, 1, 4] })
      update(state, {
        $push: {
          numbers: { $each: [2, 5], $sort: 1 },
        },
      })
      expect(state.numbers).toEqual([1, 2, 3, 4, 5])
    })

    it('should support descending $sort', () => {
      const [state] = createStore({ numbers: [3, 1, 4] })
      update(state, {
        $push: {
          numbers: { $each: [2, 5], $sort: -1 },
        },
      })
      expect(state.numbers).toEqual([5, 4, 3, 2, 1])
    })

    it('should trigger reactivity for arrays', () => {
      const [state] = createStore({ items: ['a'] })
      let effectCount = 0
      effect(() => {
        state.items.length // Access length
        effectCount++
      })
      expect(effectCount).toBe(1)

      update(state, {
        $push: { items: 'b' },
      })
      expect(effectCount).toBe(2)
    })
  })

  describe('$pull operator', () => {
    it('should remove matching elements from array', () => {
      const [state] = createStore({ items: ['a', 'b', 'c', 'b'] })
      update(state, {
        $pull: { items: 'b' },
      })
      expect(state.items).toEqual(['a', 'c'])
    })

    it('should remove objects by deep equality', () => {
      const [state] = createStore({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
        ],
      })
      update(state, {
        $pull: { users: { id: 2, name: 'Bob' } },
      })
      expect(state.users).toEqual([
        { id: 1, name: 'Alice' },
        { id: 3, name: 'Charlie' },
      ])
    })

    it('should handle nested arrays', () => {
      const [state] = createStore({
        data: { tags: ['a', 'b', 'c', 'b'] },
      })
      update(state, {
        $pull: { 'data.tags': 'b' },
      })
      expect(state.data.tags).toEqual(['a', 'c'])
    })

    it('should do nothing if array does not exist', () => {
      const [state] = createStore<any>({})
      update(state, {
        $pull: { items: 'value' },
      })
      expect(state.items).toBeUndefined()
    })
  })

  describe('$pop operator', () => {
    it('should remove last element with 1', () => {
      const [state] = createStore({ items: ['a', 'b', 'c'] })
      update(state, {
        $pop: { items: 1 },
      })
      expect(state.items).toEqual(['a', 'b'])
    })

    it('should remove first element with -1', () => {
      const [state] = createStore({ items: ['a', 'b', 'c'] })
      update(state, {
        $pop: { items: -1 },
      })
      expect(state.items).toEqual(['b', 'c'])
    })

    it('should handle empty arrays gracefully', () => {
      const [state] = createStore({ items: [] })
      update(state, {
        $pop: { items: 1 },
      })
      expect(state.items).toEqual([])
    })

    it('should work with nested arrays', () => {
      const [state] = createStore({
        data: { values: [1, 2, 3] },
      })
      update(state, {
        $pop: { 'data.values': 1 },
      })
      expect(state.data.values).toEqual([1, 2])
    })
  })

  describe('$addToSet operator', () => {
    it('should add unique element to array', () => {
      const [state] = createStore({ tags: ['a', 'b'] })
      update(state, {
        $addToSet: { tags: 'c' },
      })
      expect(state.tags).toEqual(['a', 'b', 'c'])
    })

    it('should not add duplicate elements', () => {
      const [state] = createStore({ tags: ['a', 'b', 'c'] })
      update(state, {
        $addToSet: { tags: 'b' },
      })
      expect(state.tags).toEqual(['a', 'b', 'c'])
    })

    it('should support $each modifier', () => {
      const [state] = createStore({ tags: ['a'] })
      update(state, {
        $addToSet: {
          tags: { $each: ['b', 'c', 'a', 'd'] },
        },
      })
      expect(state.tags).toEqual(['a', 'b', 'c', 'd'])
    })

    it('should check deep equality for objects', () => {
      const [state] = createStore({
        users: [{ id: 1, name: 'Alice' }],
      })
      update(state, {
        $addToSet: {
          users: { id: 1, name: 'Alice' }, // Duplicate
        },
      })
      expect(state.users.length).toBe(1)

      update(state, {
        $addToSet: {
          users: { id: 2, name: 'Bob' }, // New
        },
      })
      expect(state.users.length).toBe(2)
      expect(state.users[1]).toEqual({ id: 2, name: 'Bob' })
    })

    it('should create array if it does not exist', () => {
      const [state] = createStore<any>({})
      update(state, {
        $addToSet: { tags: 'first' },
      })
      expect(state.tags).toEqual(['first'])
    })
  })

  describe('$rename operator', () => {
    it('should rename top-level fields', () => {
      const [state] = createStore<any>({ oldName: 'value', keep: 'same' })
      update(state, {
        $rename: { oldName: 'newName' },
      })
      expect(state.oldName).toBeUndefined()
      expect(state.newName).toBe('value')
      expect(state.keep).toBe('same')
    })

    it('should rename nested fields', () => {
      const [state] = createStore<any>({
        user: { firstName: 'John', age: 30 },
      })
      update(state, {
        $rename: { 'user.firstName': 'user.name' },
      })
      expect(state.user.firstName).toBeUndefined()
      expect(state.user.name).toBe('John')
      expect(state.user.age).toBe(30)
    })

    it('should rename across different paths', () => {
      const [state] = createStore<any>({
        old: { data: 'value' },
        new: {},
      })
      update(state, {
        $rename: { 'old.data': 'new.data' },
      })
      expect(state.old.data).toBeUndefined()
      expect(state.new.data).toBe('value')
    })

    it('should not create field if source does not exist', () => {
      const [state] = createStore<any>({ other: 'value' })
      update(state, {
        $rename: { nonexistent: 'newField' },
      })
      expect(state.newField).toBeUndefined()
      expect('newField' in state).toBe(false)
    })
  })

  describe('$min operator', () => {
    it('should update if new value is smaller', () => {
      const [state] = createStore({ score: 100 })
      update(state, {
        $min: { score: 50 },
      })
      expect(state.score).toBe(50)
    })

    it('should not update if new value is larger', () => {
      const [state] = createStore({ score: 100 })
      update(state, {
        $min: { score: 150 },
      })
      expect(state.score).toBe(100)
    })

    it('should set value if field is undefined', () => {
      const [state] = createStore<any>({})
      update(state, {
        $min: { score: 75 },
      })
      expect(state.score).toBe(75)
    })

    it('should work with dates', () => {
      const date1 = new Date('2024-01-01')
      const date2 = new Date('2023-01-01')
      const [state] = createStore({ date: date1 })
      update(state, {
        $min: { date: date2 },
      })
      expect(state.date).toBe(date2)
    })

    it('should work with nested fields', () => {
      const [state] = createStore({
        stats: { low: 100, high: 200 },
      })
      update(state, {
        $min: { 'stats.low': 50 },
      })
      expect(state.stats.low).toBe(50)
    })
  })

  describe('$max operator', () => {
    it('should update if new value is larger', () => {
      const [state] = createStore({ score: 50 })
      update(state, {
        $max: { score: 100 },
      })
      expect(state.score).toBe(100)
    })

    it('should not update if new value is smaller', () => {
      const [state] = createStore({ score: 100 })
      update(state, {
        $max: { score: 50 },
      })
      expect(state.score).toBe(100)
    })

    it('should set value if field is undefined', () => {
      const [state] = createStore<any>({})
      update(state, {
        $max: { score: 75 },
      })
      expect(state.score).toBe(75)
    })

    it('should work with nested fields', () => {
      const [state] = createStore({
        stats: { low: 100, high: 200 },
      })
      update(state, {
        $max: { 'stats.high': 300 },
      })
      expect(state.stats.high).toBe(300)
    })
  })

  describe('Multiple operators', () => {
    it('should apply multiple operators in correct order', () => {
      const [state] = createStore({
        count: 10,
        multiplier: 2,
        items: ['a'],
        tags: ['tag1'],
        score: 100,
      })

      update(state, {
        $inc: { count: 5 }, // 10 + 5 = 15
        $mul: { multiplier: 3 }, // 2 * 3 = 6
        $push: { items: 'b' }, // ['a', 'b']
        $addToSet: { tags: 'tag2' }, // ['tag1', 'tag2']
        $min: { score: 50 }, // min(100, 50) = 50
      })

      expect(state.count).toBe(15)
      expect(state.multiplier).toBe(6)
      expect(state.items).toEqual(['a', 'b'])
      expect(state.tags).toEqual(['tag1', 'tag2'])
      expect(state.score).toBe(50)
    })

    it('should batch all updates in single transaction', () => {
      const [state] = createStore({ a: 1, b: 2, c: 3 })
      let effectCount = 0
      effect(() => {
        // Access all properties
        state.a + state.b + state.c
        effectCount++
      })
      expect(effectCount).toBe(1)

      update(state, {
        $set: { a: 10 },
        $inc: { b: 10 },
        $mul: { c: 10 },
      })

      // Should only trigger one effect due to batching
      expect(effectCount).toBe(2)
      expect(state.a).toBe(10)
      expect(state.b).toBe(12)
      expect(state.c).toBe(30)
    })
  })

  describe('Error handling', () => {
    it('should throw error for unknown operators', () => {
      const [state] = createStore({ value: 1 })
      expect(() => {
        update(state, {
          $unknownOp: { value: 2 },
        } as UpdateOperations)
      }).toThrow('Unknown update operator: $unknownOp')
    })

    it('should handle operations on non-existent paths gracefully', () => {
      const [state] = createStore<any>({ existing: 'value' })

      // These should not throw
      update(state, {
        $inc: { 'deep.nested.count': 5 },
      })
      expect(state.deep.nested.count).toBe(5)

      update(state, {
        $push: { 'another.nested.array': 'item' },
      })
      expect(state.another.nested.array).toEqual(['item'])
    })
  })

  describe('Complex nested operations', () => {
    it('should handle complex nested document updates', () => {
      const [state] = createStore({
        users: [
          {
            id: 1,
            name: 'Alice',
            profile: {
              bio: 'Original bio',
              stats: { posts: 10, likes: 100 },
            },
            tags: ['user'],
          },
        ],
      })

      update(state, {
        $set: {
          'users.0.profile.bio': 'Updated bio',
          'users.0.email': 'alice@example.com',
        },
        $inc: {
          'users.0.profile.stats.posts': 1,
          'users.0.profile.stats.likes': 10,
        },
        $push: {
          'users.0.tags': { $each: ['admin', 'verified'] },
        },
      })

      expect(state.users[0].profile.bio).toBe('Updated bio')
      expect(state.users[0].email).toBe('alice@example.com')
      expect(state.users[0].profile.stats.posts).toBe(11)
      expect(state.users[0].profile.stats.likes).toBe(110)
      expect(state.users[0].tags).toEqual(['user', 'admin', 'verified'])
    })
  })

  describe('Reactivity preservation', () => {
    it('should maintain fine-grained reactivity after updates', () => {
      const [state] = createStore({
        user: { name: 'John', age: 30 },
        posts: [{ title: 'Post 1', likes: 10 }],
      })

      let nameEffectCount = 0
      let ageEffectCount = 0
      let postEffectCount = 0

      effect(() => {
        state.user.name // Only track name
        nameEffectCount++
      })

      effect(() => {
        state.user.age // Only track age
        ageEffectCount++
      })

      effect(() => {
        state.posts[0].likes // Only track first post likes
        postEffectCount++
      })

      expect(nameEffectCount).toBe(1)
      expect(ageEffectCount).toBe(1)
      expect(postEffectCount).toBe(1)

      // Update only name - should only trigger name effect
      update(state, {
        $set: { 'user.name': 'Jane' },
      })
      expect(nameEffectCount).toBe(2)
      expect(ageEffectCount).toBe(1)
      expect(postEffectCount).toBe(1)

      // Update only age - should only trigger age effect
      update(state, {
        $inc: { 'user.age': 1 },
      })
      expect(nameEffectCount).toBe(2)
      expect(ageEffectCount).toBe(2)
      expect(postEffectCount).toBe(1)

      // Update post likes - should only trigger post effect
      update(state, {
        $inc: { 'posts.0.likes': 5 },
      })
      expect(nameEffectCount).toBe(2)
      expect(ageEffectCount).toBe(2)
      expect(postEffectCount).toBe(2)
    })
  })
})
