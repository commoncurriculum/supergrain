import { describe, it, expect, vi } from 'vitest'
import { createStore, effect } from '../../src'

describe('MongoDB Style Operators', () => {
  it('$set: should set top-level and nested properties', () => {
    const [state, update] = createStore({
      user: { name: 'John', address: { city: 'New York' } },
    })
    update({
      $set: { 'user.name': 'Jane', 'user.address.city': 'Boston' },
    })
    expect(state.user.name).toBe('Jane')
    expect(state.user.address.city).toBe('Boston')
  })

  it('$unset: should remove a property', () => {
    const [state, update] = createStore({
      user: { name: 'John', email: 'john@doe.com' },
    })
    update({ $unset: { 'user.email': 1 } })
    expect(state.user.name).toBe('John')
    expect((state.user as any).email).toBeUndefined()
  })

  it('$inc: should increment numeric values', () => {
    const [state, update] = createStore({
      stats: { views: 100, likes: 50 },
    })
    update({ $inc: { 'stats.views': 1, 'stats.likes': -5 } })
    expect(state.stats.views).toBe(101)
    expect(state.stats.likes).toBe(45)
  })

  it('$push: should add an element to an array', () => {
    const [state, update] = createStore({ tags: ['a', 'b'] })
    update({ $push: { tags: 'c' } })
    expect(state.tags).toEqual(['a', 'b', 'c'])
  })

  it('$push: should add multiple elements with $each', () => {
    const [state, update] = createStore({ tags: ['a', 'b'] })
    update({ $push: { tags: { $each: ['c', 'd'] } } })
    expect(state.tags).toEqual(['a', 'b', 'c', 'd'])
  })

  it('$pull: should remove elements from an array by value', () => {
    const [state, update] = createStore({ scores: [1, 2, 3, 2, 4] })
    update({ $pull: { scores: 2 } })
    expect(state.scores).toEqual([1, 3, 4])
  })

  it('$pull: should remove elements matching an object', () => {
    const [state, update] = createStore({
      users: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
    })
    update({ $pull: { users: { id: 1, name: 'A' } } })
    expect(state.users).toEqual([{ id: 2, name: 'B' }])
  })

  it('$addToSet: should add unique elements to an array', () => {
    const [state, update] = createStore({ tags: ['a', 'b'] })
    update({ $addToSet: { tags: 'c' } })
    expect(state.tags).toEqual(['a', 'b', 'c'])
    update({ $addToSet: { tags: 'a' } }) // Try adding a duplicate
    expect(state.tags).toEqual(['a', 'b', 'c'])
  })

  it('$addToSet: should handle $each modifier', () => {
    const [state, update] = createStore({ tags: ['a', 'b'] })
    update({ $addToSet: { tags: { $each: ['c', 'a', 'd'] } } })
    expect(state.tags).toEqual(['a', 'b', 'c', 'd'])
  })

  it('$rename: should rename fields', () => {
    const [state, update] = createStore<any>({
      user: { name: 'John', address: { street: '123 Main St' } },
    })
    update({ $rename: { 'user.name': 'user.fullName' } })
    update({ $rename: { 'user.address': 'user.location' } })
    expect((state.user as any).name).toBeUndefined()
    expect((state.user as any).fullName).toBe('John')
    expect((state.user as any).address).toBeUndefined()
    expect((state.user as any).location).toEqual({ street: '123 Main St' })
  })

  it('$min: should update if value is smaller', () => {
    const [state, update] = createStore({ score: 100 })
    update({ $min: { score: 150 } })
    expect(state.score).toBe(100)
    update({ $min: { score: 50 } })
    expect(state.score).toBe(50)
  })

  it('$max: should update if value is larger', () => {
    const [state, update] = createStore({ score: 100 })
    update({ $max: { score: 50 } })
    expect(state.score).toBe(100)
    update({ $max: { score: 150 } })
    expect(state.score).toBe(150)
  })

  it('should handle reactivity correctly', () => {
    const [state, update] = createStore({ count: 0 })
    let currentCount = 0
    const effectFn = vi.fn(() => {
      currentCount = state.count
    })
    effect(effectFn)
    expect(currentCount).toBe(0)
    expect(effectFn).toHaveBeenCalledTimes(1)
    update({ $inc: { count: 1 } })
    expect(currentCount).toBe(1)
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle a complex combination of operators', () => {
    const [state, update] = createStore<any>({
      users: [
        { id: 1, name: 'Alice', profile: { views: 10, bio: 'Old bio' } },
        { id: 2, name: 'Bob', profile: { views: 20 } },
      ],
      meta: {
        lastUpdated: 0,
      },
    })

    update({
      $set: {
        'users.0.profile.bio': 'Updated bio',
        'users.0.profile.email': 'alice@example.com',
        'meta.lastUpdated': 12345,
      },
      $inc: { 'users.0.profile.views': 5 },
      $rename: { 'users.0.name': 'users.0.fullName' },
      $unset: { 'users.1.profile': 1 },
    })

    const firstUser = state.users[0]
    expect((firstUser as any).name).toBeUndefined()
    expect((firstUser as any).fullName).toBe('Alice')
    expect(firstUser.profile.bio).toBe('Updated bio')
    expect(firstUser.profile.email).toBe('alice@example.com')
    expect(firstUser.profile.views).toBe(15)

    const secondUser = state.users[1]
    expect(secondUser.name).toBe('Bob')
    expect((secondUser as any).profile).toBeUndefined()

    expect(state.meta.lastUpdated).toBe(12345)
  })
})
