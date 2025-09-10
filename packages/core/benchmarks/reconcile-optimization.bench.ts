import { bench, describe } from 'vitest'
import { createStore } from '../src'

describe('Reconcile Optimization Benchmark', () => {
  // Test data structures for different scenarios
  const createSimpleStore = () =>
    createStore({
      counter: 0,
      user: { name: 'John', age: 30 },
      items: [1, 2, 3, 4, 5],
    })

  const createComplexStore = () =>
    createStore({
      users: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        profile: {
          views: Math.floor(Math.random() * 1000),
          settings: { theme: 'dark', notifications: true },
        },
        tasks: Array.from({ length: 10 }, (_, j) => ({
          id: j,
          text: `Task ${j}`,
          completed: Math.random() > 0.5,
        })),
      })),
      metadata: {
        totalUsers: 100,
        activeUsers: 0,
        lastUpdated: Date.now(),
      },
      tags: ['work', 'personal', 'urgent', 'low-priority'],
    })

  const createNestedStore = () =>
    createStore({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                data: Array.from({ length: 50 }, (_, i) => ({
                  id: i,
                  nested: { deep: { value: i * 2 } },
                })),
              },
            },
          },
        },
      },
    })

  describe('Simple Operations (Post-Optimization)', () => {
    bench('$inc: increment single property (1000 ops)', () => {
      const [, update] = createSimpleStore()
      for (let i = 0; i < 1000; i++) {
        update({ $inc: { counter: 1 } })
      }
    })

    bench('$set: update nested property (1000 ops)', () => {
      const [, update] = createSimpleStore()
      for (let i = 0; i < 1000; i++) {
        update({ $set: { 'user.age': 30 + i } })
      }
    })

    bench('$push: add to array (1000 ops)', () => {
      const [, update] = createSimpleStore()
      for (let i = 0; i < 1000; i++) {
        update({ $push: { items: i + 10 } })
      }
    })

    bench('$pull: remove from array (100 ops)', () => {
      const [, update] = createComplexStore()
      for (let i = 0; i < 100; i++) {
        update({ $pull: { tags: 'work' } })
        update({ $push: { tags: 'work' } }) // Add back to maintain consistent state
      }
    })
  })

  describe('Complex Operations (Post-Optimization)', () => {
    bench('Batched updates: $set + $inc + $push (1000 ops)', () => {
      const [, update] = createSimpleStore()
      for (let i = 0; i < 1000; i++) {
        update({
          $set: { 'user.name': `User ${i}` },
          $inc: { counter: 1 },
          $push: { items: i + 100 },
        })
      }
    })

    bench('Sparse updates in large object (1000 ops)', () => {
      const [, update] = createComplexStore()
      for (let i = 0; i < 1000; i++) {
        const userId = i % 100
        update({ $inc: { [`users.${userId}.profile.views`]: 1 } })
      }
    })

    bench('Deep nested updates (1000 ops)', () => {
      const [, update] = createNestedStore()
      for (let i = 0; i < 1000; i++) {
        const dataIndex = i % 50
        update({
          $set: {
            [`level1.level2.level3.level4.level5.data.${dataIndex}.nested.deep.value`]:
              i,
          },
        })
      }
    })

    bench('Array operations on large dataset (500 ops)', () => {
      const [, update] = createComplexStore()
      for (let i = 0; i < 500; i++) {
        // Mix of push and pull operations
        if (i % 2 === 0) {
          update({
            $push: {
              [`users.${i % 100}.tasks`]: {
                id: 1000 + i,
                text: `New Task ${i}`,
                completed: false,
              },
            },
          })
        } else {
          update({ $pull: { [`users.${i % 100}.tasks`]: { completed: true } } })
        }
      }
    })
  })

  describe('Realistic App Scenarios (Post-Optimization)', () => {
    bench('Todo App: Add/Remove/Update Tasks (1000 ops)', () => {
      const [, update] = createStore({
        todos: [],
        stats: { total: 0, completed: 0 },
        filter: 'all' as 'all' | 'active' | 'completed',
      })

      for (let i = 0; i < 1000; i++) {
        const operation = i % 4
        switch (operation) {
          case 0: // Add todo
            update({
              $push: { todos: { id: i, text: `Task ${i}`, completed: false } },
              $inc: { 'stats.total': 1 },
            })
            break
          case 1: // Complete todo
            if (i > 0) {
              const todoIndex = (i - 1) % 10
              update({
                $set: { [`todos.${todoIndex}.completed`]: true },
                $inc: { 'stats.completed': 1 },
              })
            }
            break
          case 2: // Update filter
            const filters = ['all', 'active', 'completed'] as const
            update({ $set: { filter: filters[i % 3] } })
            break
          case 3: // Remove completed todos
            update({ $pull: { todos: { completed: true } } })
            break
        }
      }
    })

    bench('E-commerce Cart: Product Management (1000 ops)', () => {
      const [, update] = createStore({
        cart: {
          items: [],
          total: 0,
          itemCount: 0,
        },
        user: {
          preferences: { currency: 'USD', theme: 'light' },
          recentlyViewed: [],
        },
      })

      for (let i = 0; i < 1000; i++) {
        const operation = i % 5
        switch (operation) {
          case 0: // Add item to cart
            update({
              $push: {
                'cart.items': {
                  id: i,
                  name: `Product ${i}`,
                  price: Math.floor(Math.random() * 100),
                  quantity: 1,
                },
              },
              $inc: {
                'cart.itemCount': 1,
                'cart.total': Math.floor(Math.random() * 100),
              },
            })
            break
          case 1: // Update quantity
            if (i > 0) {
              const itemIndex = (i - 1) % 10
              update({
                $inc: {
                  [`cart.items.${itemIndex}.quantity`]: 1,
                  'cart.total': 50,
                },
              })
            }
            break
          case 2: // Remove item
            update({ $pull: { 'cart.items': { id: i - 50 } } })
            break
          case 3: // Update preferences
            update({
              $set: {
                'user.preferences.theme': i % 2 === 0 ? 'dark' : 'light',
                'user.preferences.currency': i % 3 === 0 ? 'EUR' : 'USD',
              },
            })
            break
          case 4: // Add to recently viewed
            update({
              $push: {
                'user.recentlyViewed': { id: i, timestamp: Date.now() },
              },
            })
            break
        }
      }
    })

    bench('Data Grid: Row Operations (500 ops)', () => {
      const [, update] = createStore({
        rows: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          selected: false,
          data: {
            name: `Row ${i}`,
            value: Math.floor(Math.random() * 1000),
            status: i % 3 === 0 ? 'active' : 'inactive',
          },
        })),
        selection: {
          selectedIds: [],
          selectAll: false,
        },
        sorting: {
          column: 'name',
          direction: 'asc' as 'asc' | 'desc',
        },
      })

      for (let i = 0; i < 500; i++) {
        const operation = i % 6
        const rowIndex = i % 1000

        switch (operation) {
          case 0: // Select row
            update({
              $set: { [`rows.${rowIndex}.selected`]: true },
              $push: { 'selection.selectedIds': rowIndex },
            })
            break
          case 1: // Update row data
            update({
              $set: {
                [`rows.${rowIndex}.data.value`]: Math.floor(
                  Math.random() * 1000
                ),
                [`rows.${rowIndex}.data.status`]:
                  i % 2 === 0 ? 'active' : 'inactive',
              },
            })
            break
          case 2: // Deselect row
            update({
              $set: { [`rows.${rowIndex}.selected`]: false },
              $pull: { 'selection.selectedIds': rowIndex },
            })
            break
          case 3: // Sort change
            update({
              $set: {
                'sorting.column': i % 2 === 0 ? 'name' : 'value',
                'sorting.direction': i % 2 === 0 ? 'asc' : 'desc',
              },
            })
            break
          case 4: // Select all toggle
            update({ $set: { 'selection.selectAll': !(i % 10 < 5) } })
            break
          case 5: // Bulk status update
            const startRow = rowIndex
            const endRow = Math.min(startRow + 10, 1000)
            for (let j = startRow; j < endRow; j++) {
              update({ $set: { [`rows.${j}.data.status`]: 'bulk-updated' } })
            }
            break
        }
      }
    })
  })

  describe('Performance Stress Tests (Post-Optimization)', () => {
    bench('High-frequency updates (10000 ops)', () => {
      const [, update] = createSimpleStore()
      for (let i = 0; i < 10000; i++) {
        update({ $inc: { counter: 1 } })
      }
    })

    bench('Mixed operations on complex state (2000 ops)', () => {
      const [, update] = createComplexStore()
      for (let i = 0; i < 2000; i++) {
        const operations = [
          () => update({ $inc: { 'metadata.activeUsers': 1 } }),
          () =>
            update({
              $set: { [`users.${i % 100}.name`]: `Updated User ${i}` },
            }),
          () => update({ $push: { tags: `tag-${i}` } }),
          () => update({ $pull: { tags: 'urgent' } }),
          () =>
            update({
              $set: { 'metadata.lastUpdated': Date.now() },
              $inc: { 'metadata.totalUsers': 1 },
            }),
        ]
        operations[i % operations.length]()
      }
    })

    bench('Deep nesting with arrays (1000 ops)', () => {
      const [, update] = createNestedStore()
      for (let i = 0; i < 1000; i++) {
        const dataIndex = i % 50
        update({
          $set: {
            [`level1.level2.level3.level4.level5.data.${dataIndex}.nested.deep.value`]:
              i,
          },
          $inc: {
            [`level1.level2.level3.level4.level5.data.${dataIndex}.id`]: 1,
          },
        })
      }
    })
  })

  describe('Memory and GC Pressure Tests (Post-Optimization)', () => {
    bench('Rapid object creation and modification (5000 ops)', () => {
      const [, update] = createStore({ objects: [] })

      for (let i = 0; i < 5000; i++) {
        if (i % 100 === 0) {
          // Periodic cleanup to simulate real app behavior
          update({ $set: { objects: [] } })
        } else {
          update({
            $push: {
              objects: {
                id: i,
                timestamp: Date.now(),
                data: { value: Math.random(), processed: false },
              },
            },
          })
        }
      }
    })

    bench('Array growth and shrinkage cycles (1000 ops)', () => {
      const [, update] = createStore({ dynamicArray: [] })

      for (let i = 0; i < 1000; i++) {
        if (i % 50 < 25) {
          // Growth phase
          update({ $push: { dynamicArray: { id: i, data: `Item ${i}` } } })
        } else {
          // Shrinkage phase
          update({ $pull: { dynamicArray: { id: i - 25 } } })
        }
      }
    })
  })
})
