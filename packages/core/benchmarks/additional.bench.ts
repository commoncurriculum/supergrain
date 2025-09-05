import { bench, describe } from 'vitest'
import { createStore, update } from '../src'
import { effect } from 'alien-signals'

/**
 * Additional benchmarks for detailed performance analysis
 * These tests provide deeper insights but are not essential for quick iteration
 */

// Helper to verify we're in a reactive context
function verifyReactiveContext(testName: string) {
  let tracked = false
  const [testStore] = createStore({ value: 1 })

  const dispose = effect(() => {
    const _ = testStore.value
    tracked = true
  })

  testStore.value = 2
  dispose()

  if (!tracked) {
    throw new Error(
      `${testName}: Reactive context verification failed - effects are not tracking properly`
    )
  }
}

// Verify reactive context before running benchmarks
verifyReactiveContext('Additional benchmarks')

describe('Additional: Proxy Overhead Analysis', () => {
  describe('Raw Proxy vs Plain Object', () => {
    const plainObject = { name: 'John Doe', age: 30 }
    const [proxyObject] = createStore({ name: 'John Doe', age: 30 })

    bench('plain object: 100k property reads', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = plainObject.name
      }
    })

    bench('proxy object: 100k property reads', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = proxyObject.name
      }
    })

    bench('plain object: 100k property writes', () => {
      const obj = { count: 0 }
      for (let i = 0; i < 100000; i++) {
        obj.count = i
      }
    })

    bench('proxy object: 100k property writes', () => {
      const [obj] = createStore({ count: 0 })
      for (let i = 0; i < 100000; i++) {
        obj.count = i
      }
    })
  })

  describe('Deep Object Access Overhead', () => {
    const plainDeep = {
      level1: {
        level2: {
          level3: {
            value: 42,
          },
        },
      },
    }

    const [proxyDeep] = createStore({
      level1: {
        level2: {
          level3: {
            value: 42,
          },
        },
      },
    })

    bench('plain object: deep property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = plainDeep.level1.level2.level3.value
      }
    })

    bench('proxy object: deep property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = proxyDeep.level1.level2.level3.value
      }
    })
  })
})

describe('Additional: Memory Patterns', () => {
  bench('memory: create 10k entities', () => {
    const entities: any[] = []
    for (let i = 0; i < 10000; i++) {
      const [store] = createStore({
        id: i,
        name: `Entity ${i}`,
        value: i * 2,
        metadata: {
          created: Date.now(),
          updated: Date.now(),
        },
      })
      entities.push(store)
    }
    // Keep reference to prevent GC
    entities.length
  })

  bench('memory: 5k entities with effects', () => {
    const disposers: (() => void)[] = []
    let totalTracked = 0

    for (let i = 0; i < 5000; i++) {
      const [store] = createStore({
        id: i,
        value: i * 2,
      })

      disposers.push(
        effect(() => {
          const _ = store.value
          totalTracked++
        })
      )
    }

    // Verify effects actually ran (one per entity)
    if (totalTracked !== 5000) {
      throw new Error(
        `Memory test: Effects ran ${totalTracked} times, expected 5000`
      )
    }

    // Clean up
    disposers.forEach(d => d())
  })

  bench('memory: create and destroy 10k effects', () => {
    const [store] = createStore({ counter: 0 })
    let totalTracked = 0

    for (let i = 0; i < 10000; i++) {
      const dispose = effect(() => {
        const _ = store.counter
        totalTracked++
      })
      dispose()
    }

    // Verify effects actually ran (one per iteration)
    if (totalTracked !== 10000) {
      throw new Error(
        `Memory test: Effects ran ${totalTracked} times, expected 10000`
      )
    }
  })
})

describe('Additional: Internal Characteristics', () => {
  bench('signal creation overhead (first reactive access)', () => {
    const [store] = createStore({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
      g: 7,
      h: 8,
      i: 9,
      j: 10,
    })
    let total = 0
    let effectRan = false
    const dispose = effect(() => {
      effectRan = true
      // First access creates signals
      total =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j
    })

    if (!effectRan) {
      throw new Error('Signal creation test: Effect did not run')
    }

    dispose()
  })

  bench('cached signal access (subsequent reactive access)', () => {
    const [store] = createStore({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      e: 5,
      f: 6,
      g: 7,
      h: 8,
      i: 9,
      j: 10,
    })

    // Create signals first
    let initRan = false
    const initDispose = effect(() => {
      initRan = true
      const _ =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j
    })

    if (!initRan) {
      throw new Error('Cached signal test: Initial effect did not run')
    }

    initDispose()

    // Now measure subsequent access
    let total = 0
    let secondRan = false
    const dispose = effect(() => {
      secondRan = true
      total =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j
    })

    if (!secondRan) {
      throw new Error('Cached signal test: Second effect did not run')
    }

    dispose()
  })

  bench('proxy cache effectiveness', () => {
    const [store] = createStore({
      nested: { deeply: { nested: { value: 42 } } },
    })

    // Access the same path repeatedly (should use cached proxies)
    let total = 0
    for (let i = 0; i < 1000; i++) {
      const nested = store.nested
      const deeply = nested.deeply
      const innerNested = deeply.nested
      total += innerNested.value
    }
  })
})

describe('Additional: MongoDB Operators Detailed', () => {
  bench('$set - deep nested field with dot notation', () => {
    const [state] = createStore({
      user: {
        profile: {
          settings: {
            notifications: {
              email: true,
              push: false,
            },
          },
        },
      },
    })
    update(state, {
      $set: { 'user.profile.settings.notifications.email': false },
    })
  })

  bench('$inc - nested numeric fields', () => {
    const [state] = createStore({
      stats: {
        views: 100,
        likes: 50,
        shares: 10,
        nested: {
          comments: 5,
          replies: 2,
        },
      },
    })
    update(state, {
      $inc: {
        'stats.views': 1,
        'stats.likes': 2,
        'stats.nested.comments': 1,
      },
    })
  })

  bench('$push - with complex modifiers', () => {
    const [state] = createStore({
      items: [
        { id: 3, score: 85 },
        { id: 1, score: 90 },
        { id: 4, score: 75 },
      ],
    })
    update(state, {
      $push: {
        items: {
          $each: [
            { id: 2, score: 95 },
            { id: 5, score: 80 },
          ],
          $position: 1,
          $slice: 5,
          $sort: { score: -1 },
        },
      },
    })
  })

  bench('$pull - with complex criteria', () => {
    const [state] = createStore({
      items: [
        { id: 1, status: 'active', value: 10 },
        { id: 2, status: 'inactive', value: 20 },
        { id: 3, status: 'active', value: 30 },
        { id: 4, status: 'inactive', value: 40 },
        { id: 5, status: 'active', value: 50 },
      ],
    })
    update(state, {
      $pull: { items: { status: 'inactive' } },
    })
  })

  bench('$addToSet - with objects', () => {
    const [state] = createStore({
      tags: [
        { id: 1, name: 'javascript' },
        { id: 2, name: 'typescript' },
      ],
    })
    update(state, {
      $addToSet: {
        tags: {
          $each: [
            { id: 2, name: 'typescript' }, // duplicate
            { id: 3, name: 'react' },
            { id: 4, name: 'vue' },
          ],
        },
      },
    })
  })

  bench('$rename - multiple fields', () => {
    const [state] = createStore({
      oldName1: 'value1',
      oldName2: 'value2',
      nested: {
        oldField: 'value3',
      },
    })
    update(state, {
      $rename: {
        oldName1: 'newName1',
        oldName2: 'newName2',
        'nested.oldField': 'nested.newField',
      },
    })
  })

  bench('$min/$max - conditional updates', () => {
    const [state] = createStore({
      scores: {
        high: 100,
        low: 10,
        current: 50,
      },
    })
    update(state, {
      $min: { 'scores.low': 5 },
      $max: { 'scores.high': 150 },
    })
  })

  bench('Combined operators - complex update', () => {
    const [state] = createStore({
      post: {
        title: 'Original',
        views: 100,
        likes: 50,
        tags: ['javascript'],
        comments: [{ id: 1, text: 'Great!', likes: 10 }],
        metadata: {
          created: Date.now(),
          updated: null,
        },
      },
    })
    update(state, {
      $set: {
        'post.title': 'Updated Title',
        'post.metadata.updated': Date.now(),
      },
      $inc: {
        'post.views': 1,
        'post.likes': 5,
        'post.comments.0.likes': 1,
      },
      $push: {
        'post.tags': { $each: ['typescript', 'react'] },
        'post.comments': {
          id: 2,
          text: 'Nice post!',
          likes: 0,
        },
      },
    })
  })

  bench('Large batch update - 100 fields', () => {
    const obj: any = {}
    for (let i = 0; i < 100; i++) {
      obj[`field${i}`] = {
        value: i,
        nested: { count: i * 2 },
      }
    }
    const [state] = createStore(obj)

    const updates: any = {}
    const increments: any = {}
    for (let i = 0; i < 50; i++) {
      updates[`field${i}.value`] = i * 3
      increments[`field${i}.nested.count`] = 10
    }

    update(state, {
      $set: updates,
      $inc: increments,
    })
  })
})

describe('Additional: Depth Impact Analysis', () => {
  bench('depth 1: shallow access', () => {
    const [store] = createStore({ value: 42 })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.value
    }
  })

  bench('depth 3: moderate nesting', () => {
    const [store] = createStore({
      level1: { level2: { level3: { value: 42 } } },
    })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.level1.level2.level3.value
    }
  })

  bench('depth 5: deep nesting', () => {
    const [store] = createStore({
      l1: { l2: { l3: { l4: { l5: { value: 42 } } } } },
    })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.l1.l2.l3.l4.l5.value
    }
  })

  bench('depth 7: very deep nesting', () => {
    const [store] = createStore({
      l1: {
        l2: {
          l3: {
            l4: {
              l5: {
                l6: {
                  l7: { value: 42 },
                },
              },
            },
          },
        },
      },
    })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.l1.l2.l3.l4.l5.l6.l7.value
    }
  })

  bench('depth 10: extreme nesting', () => {
    const [store] = createStore({
      l1: {
        l2: {
          l3: {
            l4: {
              l5: {
                l6: {
                  l7: {
                    l8: {
                      l9: {
                        l10: { value: 42 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    let total = 0
    for (let i = 0; i < 10000; i++) {
      total += store.l1.l2.l3.l4.l5.l6.l7.l8.l9.l10.value
    }
  })
})

describe('Additional: Array Method Performance', () => {
  bench('array map (non-mutating)', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 10; i++) {
      const mapped = store.items.map(x => x * 2)
    }
  })

  bench('array filter (non-mutating)', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 10; i++) {
      const filtered = store.items.filter(x => x % 2 === 0)
    }
  })

  bench('array reduce', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 10; i++) {
      const sum = store.items.reduce((acc, x) => acc + x, 0)
    }
  })

  bench('array find/findIndex', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 100; i++) {
      const found = store.items.find(x => x === 50)
      const index = store.items.findIndex(x => x === 50)
    }
  })

  bench('array some/every', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 100; i++) {
      const hasEven = store.items.some(x => x % 2 === 0)
      const allPositive = store.items.every(x => x >= 0)
    }
  })

  bench('array includes/indexOf', () => {
    const [store] = createStore<{ items: number[] }>({
      items: Array.from({ length: 100 }, (_, i) => i),
    })

    for (let i = 0; i < 100; i++) {
      const has50 = store.items.includes(50)
      const index50 = store.items.indexOf(50)
    }
  })
})

describe('Additional: Complex Use Cases', () => {
  bench('form state management with validation', () => {
    const [form, setForm] = createStore({
      fields: {
        firstName: { value: '', error: '', touched: false },
        lastName: { value: '', error: '', touched: false },
        email: { value: '', error: '', touched: false },
        phone: { value: '', error: '', touched: false },
        address: {
          street: { value: '', error: '', touched: false },
          city: { value: '', error: '', touched: false },
          state: { value: '', error: '', touched: false },
          zip: { value: '', error: '', touched: false },
        },
        preferences: {
          newsletter: false,
          notifications: true,
          theme: 'light',
        },
      },
      isValid: false,
      isSubmitting: false,
      errors: [] as string[],
    })

    // Simulate user input
    setForm('fields', 'firstName', 'value', 'John')
    setForm('fields', 'firstName', 'touched', true)

    setForm('fields', 'lastName', 'value', 'Doe')
    setForm('fields', 'lastName', 'touched', true)

    setForm('fields', 'email', 'value', 'john@example.com')
    setForm('fields', 'email', 'touched', true)

    // Validate email
    if (!form.fields.email.value.includes('@')) {
      setForm('fields', 'email', 'error', 'Invalid email')
      form.errors.push('Email is invalid')
    }

    // Phone validation
    setForm('fields', 'phone', 'value', '555-0123')
    setForm('fields', 'phone', 'touched', true)
    if (form.fields.phone.value.length < 10) {
      setForm('fields', 'phone', 'error', 'Phone too short')
    }

    // Address fields
    setForm('fields', 'address', 'street', 'value', '123 Main St')
    setForm('fields', 'address', 'city', 'value', 'Seattle')
    setForm('fields', 'address', 'state', 'value', 'WA')
    setForm('fields', 'address', 'zip', 'value', '98101')

    // Update preferences
    setForm('fields', 'preferences', 'newsletter', true)
    setForm('fields', 'preferences', 'theme', 'dark')

    // Check overall validity
    const hasErrors = form.errors.length > 0
    setForm('isValid', !hasErrors)
  })

  bench('data grid with sorting and filtering', () => {
    interface Row {
      id: number
      name: string
      value: number
      category: string
      selected: boolean
      visible: boolean
    }

    const [grid, setGrid] = createStore<{
      rows: Row[]
      sortBy: string | null
      sortOrder: 'asc' | 'desc'
      filterBy: string
      selectedCount: number
    }>({
      rows: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random() * 1000,
        category: ['A', 'B', 'C'][i % 3],
        selected: false,
        visible: true,
      })),
      sortBy: null,
      sortOrder: 'asc',
      filterBy: '',
      selectedCount: 0,
    })

    // Apply filter
    setGrid('filterBy', 'A')
    for (const row of grid.rows) {
      row.visible = row.category === 'A'
    }

    // Select visible rows
    let selectedCount = 0
    for (const row of grid.rows) {
      if (row.visible) {
        row.selected = true
        selectedCount++
      }
    }
    setGrid('selectedCount', selectedCount)

    // Sort simulation
    setGrid('sortBy', 'value')
    setGrid('sortOrder', 'desc')

    // Bulk update values
    for (let i = 0; i < 50; i++) {
      grid.rows[i].value = grid.rows[i].value * 1.1
    }

    // Toggle selection
    for (const row of grid.rows) {
      if (row.selected && row.value > 500) {
        row.selected = false
      }
    }

    // Clear filter
    setGrid('filterBy', '')
    for (const row of grid.rows) {
      row.visible = true
    }
  })

  bench('shopping cart with calculations', () => {
    interface CartItem {
      id: number
      productId: number
      name: string
      price: number
      quantity: number
      discount: number
      subtotal: number
    }

    const [cart, setCart] = createStore<{
      items: CartItem[]
      subtotal: number
      tax: number
      shipping: number
      discount: number
      total: number
      couponCode: string | null
    }>({
      items: [],
      subtotal: 0,
      tax: 0,
      shipping: 0,
      discount: 0,
      total: 0,
      couponCode: null,
    })

    // Add items
    for (let i = 0; i < 20; i++) {
      cart.items.push({
        id: i,
        productId: i * 10,
        name: `Product ${i}`,
        price: 10 + i * 2,
        quantity: 1,
        discount: 0,
        subtotal: 10 + i * 2,
      })
    }

    // Update quantities and calculate subtotals
    for (let i = 0; i < 10; i++) {
      cart.items[i].quantity = 2
      cart.items[i].subtotal = cart.items[i].price * cart.items[i].quantity
    }

    // Apply item-level discounts
    for (let i = 5; i < 15; i++) {
      cart.items[i].discount = 0.1 // 10% off
      cart.items[i].subtotal =
        cart.items[i].price *
        cart.items[i].quantity *
        (1 - cart.items[i].discount)
    }

    // Calculate cart totals
    let subtotal = 0
    for (const item of cart.items) {
      subtotal += item.subtotal
    }
    setCart('subtotal', subtotal)

    // Apply coupon
    setCart('couponCode', 'SAVE20')
    setCart('discount', subtotal * 0.2)

    // Calculate tax and shipping
    const discountedSubtotal = subtotal - cart.discount
    setCart('tax', discountedSubtotal * 0.08)
    setCart('shipping', discountedSubtotal > 50 ? 0 : 10)

    // Final total
    setCart('total', discountedSubtotal + cart.tax + cart.shipping)

    // Remove some items
    cart.items.splice(15, 5)

    // Recalculate after removal
    subtotal = 0
    for (const item of cart.items) {
      subtotal += item.subtotal
    }
    setCart('subtotal', subtotal)
  })

  bench('recursive tree operations', () => {
    interface TreeNode {
      id: number
      name: string
      expanded: boolean
      selected: boolean
      children: TreeNode[]
    }

    function createTree(
      depth: number,
      breadth: number,
      idStart: number = 0
    ): TreeNode {
      const node: TreeNode = {
        id: idStart,
        name: `Node ${idStart}`,
        expanded: false,
        selected: false,
        children: [],
      }

      if (depth > 0) {
        let childId = idStart + 1
        for (let i = 0; i < breadth; i++) {
          const child = createTree(depth - 1, breadth, childId)
          node.children.push(child)
          childId += Math.pow(breadth, depth - 1) + 1
        }
      }

      return node
    }

    const [tree] = createStore({
      root: createTree(3, 3), // 3 levels deep, 3 children per node
    })

    // Expand all nodes
    function expandAll(node: TreeNode) {
      node.expanded = true
      for (const child of node.children) {
        expandAll(child)
      }
    }
    expandAll(tree.root)

    // Select every other node
    function selectAlternate(node: TreeNode, select: boolean = true) {
      node.selected = select
      for (const child of node.children) {
        selectAlternate(child, !select)
      }
    }
    selectAlternate(tree.root)

    // Count selected
    function countSelected(node: TreeNode): number {
      let count = node.selected ? 1 : 0
      for (const child of node.children) {
        count += countSelected(child)
      }
      return count
    }
    const selectedCount = countSelected(tree.root)

    // Collapse leaf nodes
    function collapseLeaves(node: TreeNode) {
      if (node.children.length === 0) {
        node.expanded = false
      } else {
        for (const child of node.children) {
          collapseLeaves(child)
        }
      }
    }
    collapseLeaves(tree.root)
  })
})

describe('Additional: Batch Update Patterns', () => {
  bench('sequential single updates with tracking', () => {
    const [store, setStore] = createStore({ count: 0 })
    let effectRuns = 0

    const dispose = effect(() => {
      const _ = store.count
      effectRuns++
    })

    const initialRuns = effectRuns

    for (let i = 0; i < 100; i++) {
      setStore('count', i)
    }

    // Verify effect tracked updates (initial + 100 updates)
    if (effectRuns !== 101) {
      throw new Error(
        `Batch test: Effect ran ${effectRuns} times, expected 101`
      )
    }

    dispose()
  })

  bench('batched multi-property update with tracking', () => {
    const obj: any = {}
    for (let i = 0; i < 100; i++) {
      obj[`prop${i}`] = 0
    }
    const [store, setStore] = createStore(obj)
    let effectRuns = 0

    const dispose = effect(() => {
      let sum = 0
      for (let i = 0; i < 100; i++) {
        sum += store[`prop${i}`]
      }
      effectRuns++
    })

    const initialRuns = effectRuns

    const updates: any = {}
    for (let i = 0; i < 100; i++) {
      updates[`prop${i}`] = i
    }
    setStore(updates)

    // Verify effect tracked the batch update (initial + 1 batch update)
    if (effectRuns !== initialRuns + 1) {
      throw new Error(
        `Batch test: Effect ran ${effectRuns} times, expected ${
          initialRuns + 1
        }`
      )
    }

    dispose()
  })

  bench('mixed update patterns', () => {
    const [store, setStore] = createStore({
      user: {
        profile: { name: '', age: 0 },
        settings: { theme: 'dark', notifications: true },
        stats: { posts: 0, likes: 0 },
      },
      meta: {
        lastUpdated: 0,
        version: 1,
      },
    })

    // Direct mutations
    store.user.profile.name = 'John'
    store.user.profile.age = 30

    // Setter updates
    setStore('user', 'settings', 'theme', 'light')
    setStore('user', 'settings', 'notifications', false)

    // Batch update
    setStore('user', 'stats', { posts: 10, likes: 100 })

    // MongoDB operators
    update(store, {
      $set: { 'meta.lastUpdated': Date.now() },
      $inc: { 'meta.version': 1, 'user.stats.posts': 5 },
    })

    // More direct mutations
    store.user.stats.likes += 50

    // Nested batch
    setStore('user', 'profile', profile => ({
      ...profile,
      name: 'Jane',
      age: profile.age + 1,
    }))
  })
})

describe('Additional: Edge Cases', () => {
  bench('circular reference handling', () => {
    interface CircularNode {
      id: number
      value: number
      next?: CircularNode
      prev?: CircularNode
    }

    const [store] = createStore<{ nodes: CircularNode[] }>({ nodes: [] })

    // Create circular linked list
    for (let i = 0; i < 10; i++) {
      store.nodes.push({
        id: i,
        value: i * 10,
      })
    }

    // Link nodes circularly
    for (let i = 0; i < 10; i++) {
      store.nodes[i].next = store.nodes[(i + 1) % 10]
      store.nodes[i].prev = store.nodes[(i + 9) % 10]
    }

    // Traverse and update
    let current = store.nodes[0]
    for (let i = 0; i < 20; i++) {
      current.value += 1
      current = current.next!
    }
  })

  bench('symbol and special property handling', () => {
    const sym1 = Symbol('test1')
    const sym2 = Symbol('test2')

    const [store] = createStore<any>({
      [sym1]: 'symbol value',
      [sym2]: { nested: 'symbol nested' },
      __proto__: 'proto value',
      constructor: 'constructor value',
      regular: 'regular value',
    })

    // Update symbol properties
    store[sym1] = 'updated symbol'
    store[sym2].nested = 'updated nested'

    // Update special properties
    store.__proto__ = 'updated proto'
    store.constructor = 'updated constructor'

    // Mix with regular updates
    store.regular = 'updated regular'
  })
})
