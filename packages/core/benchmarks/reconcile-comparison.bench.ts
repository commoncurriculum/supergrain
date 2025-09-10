import { bench, describe } from 'vitest'
import { signal, startBatch, endBatch } from 'alien-signals'

// Mock the old reconcile-based approach for comparison
function createOldStyleStore<T extends object>(initialState: T) {
  const $NODE = Symbol('store-node')
  const unwrappedState = JSON.parse(JSON.stringify(initialState))

  // Old reconcile function that traverses the entire tree
  function reconcile(raw: any, visited = new Set()) {
    if (!raw || typeof raw !== 'object' || visited.has(raw)) return
    visited.add(raw)

    const nodes = raw[$NODE]
    if (nodes) {
      for (const key of Object.keys(nodes)) {
        const sig = nodes[key]
        const newValue = raw[key]
        if (sig() !== newValue) {
          sig(newValue)
        }
      }
    }

    for (const key of Object.keys(raw)) {
      if (typeof raw[key] === 'object' && raw[key] !== null) {
        reconcile(raw[key], visited)
      }
    }
  }

  // Simplified setProperty that doesn't update signals (mimics old behavior)
  function setProperty(target: any, property: string, value: any) {
    const parts = property.split('.')
    let current = target
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!current[part] || typeof current[part] !== 'object') {
        current[part] = {}
      }
      current = current[part]
    }
    current[parts[parts.length - 1]] = value
  }

  function updateOld(operations: any) {
    startBatch()
    try {
      // Apply operations without signal updates
      if (operations.$set) {
        for (const [path, value] of Object.entries(operations.$set)) {
          setProperty(unwrappedState, path, value)
        }
      }
      if (operations.$inc) {
        for (const [path, increment] of Object.entries(
          operations.$inc as Record<string, number>
        )) {
          const parts = path.split('.')
          let current = unwrappedState
          for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]]
          }
          const key = parts[parts.length - 1]
          current[key] = (current[key] || 0) + increment
        }
      }
      if (operations.$push) {
        for (const [path, value] of Object.entries(operations.$push)) {
          const parts = path.split('.')
          let current = unwrappedState
          for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]]
          }
          const key = parts[parts.length - 1]
          if (Array.isArray(current[key])) {
            current[key].push(value)
          }
        }
      }
      if (operations.$pull) {
        for (const [path, condition] of Object.entries(operations.$pull)) {
          const parts = path.split('.')
          let current = unwrappedState
          for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]]
          }
          const key = parts[parts.length - 1]
          if (Array.isArray(current[key])) {
            const arr = current[key]
            for (let i = arr.length - 1; i >= 0; i--) {
              if (JSON.stringify(arr[i]) === JSON.stringify(condition)) {
                arr.splice(i, 1)
              }
            }
          }
        }
      }

      // EXPENSIVE: Full tree reconciliation after every update
      reconcile(unwrappedState)
    } finally {
      endBatch()
    }
  }

  return [unwrappedState, updateOld] as const
}

// Import the new optimized store
import { createStore } from '../src'

describe('Reconcile Optimization Comparison', () => {
  const testData = {
    counter: 0,
    user: { name: 'John', age: 30, profile: { views: 100 } },
    items: [1, 2, 3, 4, 5],
    nested: {
      level1: {
        level2: {
          level3: { value: 42 },
        },
      },
    },
    largeArray: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      value: i * 2,
    })),
  }

  describe('Simple Operations Comparison', () => {
    bench('OLD: $inc operations (1000 ops) - WITH RECONCILE', () => {
      const [, updateOld] = createOldStyleStore(testData)
      for (let i = 0; i < 1000; i++) {
        updateOld({ $inc: { counter: 1 } })
      }
    })

    bench('NEW: $inc operations (1000 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(testData)
      for (let i = 0; i < 1000; i++) {
        updateNew({ $inc: { counter: 1 } })
      }
    })

    bench('OLD: $set nested properties (1000 ops) - WITH RECONCILE', () => {
      const [, updateOld] = createOldStyleStore(testData)
      for (let i = 0; i < 1000; i++) {
        updateOld({ $set: { 'user.age': 30 + i } })
      }
    })

    bench('NEW: $set nested properties (1000 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(testData)
      for (let i = 0; i < 1000; i++) {
        updateNew({ $set: { 'user.age': 30 + i } })
      }
    })
  })

  describe('Array Operations Comparison', () => {
    bench('OLD: $push operations (500 ops) - WITH RECONCILE', () => {
      const [, updateOld] = createOldStyleStore(testData)
      for (let i = 0; i < 500; i++) {
        updateOld({ $push: { items: i + 10 } })
      }
    })

    bench('NEW: $push operations (500 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(testData)
      for (let i = 0; i < 500; i++) {
        updateNew({ $push: { items: i + 10 } })
      }
    })

    bench('OLD: $pull operations (100 ops) - WITH RECONCILE', () => {
      const data = {
        items: Array.from({ length: 200 }, (_, i) => ({ id: i, value: i })),
      }
      const [, updateOld] = createOldStyleStore(data)
      for (let i = 0; i < 100; i++) {
        updateOld({ $pull: { items: { id: i } } })
      }
    })

    bench('NEW: $pull operations (100 ops) - NO RECONCILE', () => {
      const data = {
        items: Array.from({ length: 200 }, (_, i) => ({ id: i, value: i })),
      }
      const [, updateNew] = createStore(data)
      for (let i = 0; i < 100; i++) {
        updateNew({ $pull: { items: { id: i } } })
      }
    })
  })

  describe('Complex Operations Comparison', () => {
    bench('OLD: Batched operations (500 ops) - WITH RECONCILE', () => {
      const [, updateOld] = createOldStyleStore(testData)
      for (let i = 0; i < 500; i++) {
        updateOld({
          $set: {
            'user.name': `User ${i}`,
            'nested.level1.level2.level3.value': i,
          },
          $inc: { counter: 1, 'user.profile.views': 1 },
          $push: { items: i + 100 },
        })
      }
    })

    bench('NEW: Batched operations (500 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(testData)
      for (let i = 0; i < 500; i++) {
        updateNew({
          $set: {
            'user.name': `User ${i}`,
            'nested.level1.level2.level3.value': i,
          },
          $inc: { counter: 1, 'user.profile.views': 1 },
          $push: { items: i + 100 },
        })
      }
    })

    bench('OLD: Deep nested updates (500 ops) - WITH RECONCILE', () => {
      const [, updateOld] = createOldStyleStore(testData)
      for (let i = 0; i < 500; i++) {
        updateOld({ $set: { 'nested.level1.level2.level3.value': i } })
      }
    })

    bench('NEW: Deep nested updates (500 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(testData)
      for (let i = 0; i < 500; i++) {
        updateNew({ $set: { 'nested.level1.level2.level3.value': i } })
      }
    })
  })

  describe('Sparse Updates Comparison (Most Impactful)', () => {
    const largeStateData = {
      users: Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        profile: {
          views: Math.floor(Math.random() * 1000),
          settings: { theme: 'dark', notifications: true },
          metadata: {
            created: Date.now(),
            updated: Date.now(),
            version: 1,
          },
        },
        posts: Array.from({ length: 20 }, (_, j) => ({
          id: j,
          title: `Post ${j}`,
          content: `Content for post ${j}`,
          likes: Math.floor(Math.random() * 100),
        })),
      })),
      metadata: {
        totalUsers: 1000,
        activeUsers: 500,
        stats: {
          totalPosts: 20000,
          totalLikes: 50000,
          engagement: 0.75,
        },
      },
    }

    bench(
      'OLD: Sparse updates in large state (200 ops) - WITH RECONCILE',
      () => {
        const [, updateOld] = createOldStyleStore(largeStateData)
        for (let i = 0; i < 200; i++) {
          const userId = i % 1000
          updateOld({ $inc: { [`users.${userId}.profile.views`]: 1 } })
        }
      }
    )

    bench('NEW: Sparse updates in large state (200 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(largeStateData)
      for (let i = 0; i < 200; i++) {
        const userId = i % 1000
        updateNew({ $inc: { [`users.${userId}.profile.views`]: 1 } })
      }
    })

    bench('OLD: Multiple sparse updates (100 ops) - WITH RECONCILE', () => {
      const [, updateOld] = createOldStyleStore(largeStateData)
      for (let i = 0; i < 100; i++) {
        const userId1 = i % 1000
        const userId2 = (i + 500) % 1000
        updateOld({
          $inc: { [`users.${userId1}.profile.views`]: 1 },
          $set: { [`users.${userId2}.name`]: `Updated User ${i}` },
          $inc: { 'metadata.stats.engagement': 0.01 },
        })
      }
    })

    bench('NEW: Multiple sparse updates (100 ops) - NO RECONCILE', () => {
      const [, updateNew] = createStore(largeStateData)
      for (let i = 0; i < 100; i++) {
        const userId1 = i % 1000
        const userId2 = (i + 500) % 1000
        updateNew({
          $inc: { [`users.${userId1}.profile.views`]: 1 },
          $set: { [`users.${userId2}.name`]: `Updated User ${i}` },
          $inc: { 'metadata.stats.engagement': 0.01 },
        })
      }
    })
  })

  describe('Memory Pressure Comparison', () => {
    bench('OLD: Rapid updates with reconcile overhead (1000 ops)', () => {
      const [, updateOld] = createOldStyleStore(testData)
      for (let i = 0; i < 1000; i++) {
        updateOld({
          $set: { counter: i },
          $inc: { 'user.profile.views': 1 },
        })
      }
    })

    bench('NEW: Rapid updates without reconcile overhead (1000 ops)', () => {
      const [, updateNew] = createStore(testData)
      for (let i = 0; i < 1000; i++) {
        updateNew({
          $set: { counter: i },
          $inc: { 'user.profile.views': 1 },
        })
      }
    })
  })
})
