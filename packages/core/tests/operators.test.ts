import { describe, it, expect } from 'vitest'
import { createStore, update } from '../src'
import { effect } from 'alien-signals'

describe('MongoDB Style Operators', () => {
  it('$set: should set top-level and nested properties', () => {
    const [state] = createStore({
      user: { name: 'John', profile: { age: 30 } },
      status: 'active',
    })

    update(state, {
      $set: {
        status: 'inactive',
        'user.profile.age': 31,
      } as any,
    })

    expect(state.status).toBe('inactive')
    expect(state.user.profile.age).toBe(31)
  })

  it('$inc: should increment numeric values', () => {
    const [state] = createStore({
      stats: { views: 100, likes: 50 },
    })

    update(state, {
      $inc: {
        'stats.views': 10,
        'stats.likes': 1,
      } as any,
    })

    expect(state.stats.views).toBe(110)
    expect(state.stats.likes).toBe(51)
  })

  it('$push: should add elements to an array', () => {
    const [state] = createStore({
      tags: ['alpha'],
    })

    update(state, {
      $push: { tags: 'beta' },
    })

    expect(state.tags).toEqual(['alpha', 'beta'])
  })

  it('$push: should add multiple elements with $each', () => {
    const [state] = createStore({
      scores: [10],
    })

    update(state, {
      $push: { scores: { $each: [20, 30] } },
    })

    expect(state.scores).toEqual([10, 20, 30])
  })

  it('$pull: should remove elements from an array', () => {
    const [state] = createStore({
      tags: ['alpha', 'beta', 'gamma', 'beta'],
    })

    update(state, {
      $pull: { tags: 'beta' },
    })

    expect(state.tags).toEqual(['alpha', 'gamma'])
  })

  it('$pull: should remove elements matching an object', () => {
    const [state] = createStore({
      items: [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 1, value: 10 },
      ],
    })

    update(state, {
      $pull: { items: { id: 1, value: 10 } },
    })

    expect(state.items).toEqual([{ id: 2, value: 20 }])
  })

  it('$addToSet: should add unique elements to an array', () => {
    const [state] = createStore({
      tags: ['alpha', 'beta'],
    })

    update(state, {
      $addToSet: { tags: 'beta' }, // should not be added
    })
    expect(state.tags).toEqual(['alpha', 'beta'])

    update(state, {
      $addToSet: { tags: 'gamma' }, // should be added
    })
    expect(state.tags).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('$addToSet: should handle $each modifier', () => {
    const [state] = createStore({
      tags: ['alpha', 'beta'],
    })

    update(state, {
      $addToSet: { tags: { $each: ['beta', 'gamma', 'delta'] } },
    })

    expect(state.tags).toEqual(['alpha', 'beta', 'gamma', 'delta'])
  })

  it('$rename: should rename fields', () => {
    const [state] = createStore({
      user: {
        name: 'John',
        address: { street: '123 Main St' },
      },
    })

    update(state, {
      $rename: {
        'user.name': 'user.fullName',
        'user.address': 'user.location',
      } as any,
    })

    expect((state.user as any).name).toBeUndefined()
    expect((state.user as any).fullName).toBe('John')
    expect((state.user as any).address).toBeUndefined()
    expect((state.user as any).location).toEqual({ street: '123 Main St' })
  })

  it('$min: should update if value is smaller', () => {
    const [state] = createStore({ score: 100 })

    update(state, { $min: { score: 150 } })
    expect(state.score).toBe(100) // not changed

    update(state, { $min: { score: 50 } })
    expect(state.score).toBe(50) // changed
  })

  it('$max: should update if value is larger', () => {
    const [state] = createStore({ score: 100 })

    update(state, { $max: { score: 50 } })
    expect(state.score).toBe(100) // not changed

    update(state, { $max: { score: 150 } })
    expect(state.score).toBe(150) // changed
  })

  it('should handle reactivity correctly', () => {
    const [state] = createStore({ count: 0 })
    let effectRuns = 0

    const dispose = effect(() => {
      state.count
      effectRuns++
    })

    update(state, { $inc: { count: 1 } })
    expect(state.count).toBe(1)
    expect(effectRuns).toBe(2) // 1 initial + 1 for update

    dispose()
  })

  it('should handle a complex combination of operators', () => {
    const [state] = createStore({
      users: [
        {
          id: 1,
          name: 'Alice',
          profile: {
            email: 'alice@example.com',
            bio: 'Original bio',
            stats: { posts: 10, likes: 100 },
          },
          tags: ['user', 'admin'],
        },
      ],
      posts: [{ id: 101, title: 'Post 1', likes: 5 }],
    })

    update(state, {
      $set: {
        'users.0.profile.bio': 'Updated bio',
      } as any,
      $inc: {
        'users.0.profile.stats.posts': 1,
        'users.0.profile.stats.likes': 10,
        'posts.0.likes': 5,
      } as any,
      $push: {
        'users.0.tags': 'verified',
      } as any,
      $rename: {
        'users.0.name': 'users.0.fullName',
      } as any,
    })

    const firstUser = state.users[0]
    expect(firstUser).toBeDefined()
    if (!firstUser) return

    expect((firstUser as any).name).toBeUndefined()
    expect((firstUser as any).fullName).toBe('Alice')
    expect(firstUser.profile.bio).toBe('Updated bio')
    expect(firstUser.profile.email).toBe('alice@example.com')
    expect(firstUser.profile.stats.posts).toBe(11)
    expect(firstUser.profile.stats.likes).toBe(110)
    expect(firstUser.tags).toEqual(['user', 'admin', 'verified'])

    const firstPost = state.posts[0]
    expect(firstPost).toBeDefined()
    if (!firstPost) return

    expect(firstPost.likes).toBe(10)
  })
})
