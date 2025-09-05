import { bench, describe } from 'vitest'
import { createStore, update } from '../src'

describe('MongoDB Update Operators Performance', () => {
  bench('$set - single field', () => {
    const [state] = createStore({ count: 0, name: 'test' })
    update(state, {
      $set: { count: 100 },
    })
  })

  bench('$set - nested field with dot notation', () => {
    const [state] = createStore({
      user: {
        profile: {
          name: 'John',
          age: 30,
        },
      },
    })
    update(state, {
      $set: { 'user.profile.name': 'Jane' },
    })
  })

  bench('$set - multiple fields', () => {
    const [state] = createStore({ a: 1, b: 2, c: 3, d: 4, e: 5 })
    update(state, {
      $set: {
        a: 10,
        b: 20,
        c: 30,
        d: 40,
        e: 50,
      },
    })
  })

  bench('$inc - single field', () => {
    const [state] = createStore({ counter: 0 })
    update(state, {
      $inc: { counter: 1 },
    })
  })

  bench('$inc - multiple fields', () => {
    const [state] = createStore({ a: 1, b: 2, c: 3, d: 4, e: 5 })
    update(state, {
      $inc: {
        a: 1,
        b: 2,
        c: 3,
        d: 4,
        e: 5,
      },
    })
  })

  bench('$push - single item', () => {
    const [state] = createStore({ items: [] as string[] })
    update(state, {
      $push: { items: 'new-item' },
    })
  })

  bench('$push - with $each modifier', () => {
    const [state] = createStore({ items: [] as string[] })
    update(state, {
      $push: {
        items: {
          $each: ['item1', 'item2', 'item3'],
        },
      },
    })
  })

  bench('$push - with all modifiers', () => {
    const [state] = createStore({ items: [3, 1, 4] })
    update(state, {
      $push: {
        items: {
          $each: [2, 5],
          $position: 1,
          $slice: 5,
          $sort: 1,
        },
      },
    })
  })

  bench('$pull - remove from array', () => {
    const [state] = createStore({
      items: ['a', 'b', 'c', 'd', 'e', 'b', 'f', 'b'],
    })
    update(state, {
      $pull: { items: 'b' },
    })
  })

  bench('$addToSet - unique items', () => {
    const [state] = createStore({
      tags: ['tag1', 'tag2'],
    })
    update(state, {
      $addToSet: {
        tags: {
          $each: ['tag2', 'tag3', 'tag4'],
        },
      },
    })
  })

  bench('Multiple operators - common pattern', () => {
    const [state] = createStore({
      title: 'Original',
      viewCount: 100,
      tags: ['original'],
      metadata: { updated: false },
    })
    update(state, {
      $set: {
        title: 'Updated',
        'metadata.updated': true,
      },
      $inc: { viewCount: 1 },
      $push: { tags: 'modified' },
    })
  })

  bench('Complex nested update', () => {
    const [state] = createStore({
      users: [
        {
          id: 1,
          name: 'Alice',
          stats: { posts: 10, likes: 100 },
          tags: ['user'],
        },
      ],
    })
    update(state, {
      $set: { 'users.0.name': 'Alice Updated' },
      $inc: {
        'users.0.stats.posts': 1,
        'users.0.stats.likes': 10,
      },
      $push: {
        'users.0.tags': {
          $each: ['admin', 'verified'],
        },
      },
    })
  })

  bench('Large object update', () => {
    const obj: any = {}
    for (let i = 0; i < 100; i++) {
      obj[`field${i}`] = i
    }
    const [state] = createStore(obj)

    const updates: any = {}
    for (let i = 0; i < 50; i++) {
      updates[`field${i}`] = i * 2
    }

    update(state, {
      $set: updates,
    })
  })

  bench('Deep nesting update', () => {
    const [state] = createStore({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 0,
              },
            },
          },
        },
      },
    })
    update(state, {
      $set: { 'level1.level2.level3.level4.level5.value': 100 },
    })
  })

  bench('Array manipulation sequence', () => {
    const [state] = createStore({
      items: [1, 2, 3, 4, 5],
    })
    update(state, {
      $push: { items: { $each: [6, 7] } },
      $pull: { items: 3 },
      $pop: { items: 1 },
    })
  })

  // Comparison benchmarks with direct mutation
  bench('Direct mutation - single field (baseline)', () => {
    const [state] = createStore({ count: 0, name: 'test' })
    state.count = 100
  })

  bench('Direct mutation - nested field (baseline)', () => {
    const [state] = createStore({
      user: {
        profile: {
          name: 'John',
          age: 30,
        },
      },
    })
    state.user.profile.name = 'Jane'
  })

  bench('Direct mutation - array push (baseline)', () => {
    const [state] = createStore({ items: [] as string[] })
    state.items.push('new-item')
  })
})
