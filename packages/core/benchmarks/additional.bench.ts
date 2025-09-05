import { bench, describe } from 'vitest'
import { createStore, update } from '../src'
import { effect } from 'alien-signals'

// Helper to verify we're in a reactive context before running benchmarks
function verifyReactiveContext(storeName: string) {
  let tracked = false
  const [testStore] = createStore({ value: 1 })

  const dispose = effect(() => {
    testStore.value // Access value to track
    tracked = true
  })

  if (!tracked) {
    dispose()
    throw new Error(
      `${storeName}: Reactive context verification failed - effect did not run initially.`
    )
  }

  tracked = false
  testStore.value = 2 // Update should trigger effect

  if (!tracked) {
    dispose()
    throw new Error(
      `${storeName}: Reactive context verification failed - effect did not re-run on update.`
    )
  }

  dispose()
}

verifyReactiveContext('@storable/core')

describe('Additional: Plain vs Proxy Performance', () => {
  describe('Property Access', () => {
    const plainObject = { name: 'John Doe', age: 30 }
    const [proxyObject] = createStore({ name: 'John Doe', age: 30 })

    bench('plain object: 100k property reads', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = plainObject.name
      }
      void value
    })

    bench('proxy object: 100k property reads', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = proxyObject.name
      }
      void value
    })
  })

  describe('Property Set', () => {
    bench('plain object: 100k property sets', () => {
      const plainObject = { value: 0 }
      for (let i = 0; i < 100000; i++) {
        plainObject.value = i
      }
    })

    bench('proxy object: 100k property sets', () => {
      const [proxyObject] = createStore({ value: 0 })
      for (let i = 0; i < 100000; i++) {
        proxyObject.value = i
      }
    })
  })

  describe('Deep Property Access', () => {
    const plainDeep = { level1: { level2: { level3: { value: 'test' } } } }
    const [proxyDeep] = createStore({
      level1: { level2: { level3: { value: 'test' } } },
    })

    bench('plain object: deep property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = plainDeep.level1.level2.level3.value
      }
      void value
    })

    bench('proxy object: deep property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = proxyDeep.level1.level2.level3.value
      }
      void value
    })
  })
})

describe('Additional: Effect Creation and Destruction', () => {
  bench('create/dispose 1000 effects for one signal', () => {
    const [store] = createStore({ value: 0 })
    let totalTracked = 0
    const disposers = []

    for (let i = 0; i < 1000; i++) {
      disposers.push(
        effect(() => {
          store.value
          totalTracked++
        })
      )
    }

    for (const dispose of disposers) {
      dispose()
    }
  })

  bench('create/dispose one effect 10000 times', () => {
    const [store] = createStore({ counter: 0 })
    let totalTracked = 0

    for (let i = 0; i < 10000; i++) {
      const dispose = effect(() => {
        store.counter
        totalTracked++
      })
      dispose()
    }
  })
})

describe('Additional: Signal Subscription/Unsubscription', () => {
  bench('subscribe/unsubscribe 10k listeners to one signal', () => {
    const [store] = createStore({ value: 0 })
    const disposers = []
    for (let i = 0; i < 10000; i++) {
      disposers.push(effect(() => store.value))
    }
    for (const d of disposers) {
      d()
    }
  })
})

describe('Additional: Batched vs Unbatched Updates', () => {
  bench('10 unbatched updates triggering one effect', () => {
    const [store, setStore] = createStore({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      g: 0,
      h: 0,
      i: 0,
      j: 10,
    })
    let total = 0
    let effectRan = false
    const dispose = effect(() => {
      effectRan = true
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

    setStore('a', 1)
    setStore('b', 2)
    setStore('c', 3)
    setStore('d', 4)
    setStore('e', 5)
    setStore('f', 6)
    setStore('g', 7)
    setStore('h', 8)
    setStore('i', 9)
    setStore('j', 10)

    void total
    void effectRan
    dispose()
  })

  bench('10 batched updates triggering one effect', () => {
    const [store, _setStore] = createStore({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      g: 0,
      h: 0,
      i: 0,
      j: 10,
    })
    let total = 0
    let effectRan = false
    const initDispose = effect(() => {
      effectRan = true
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
    initDispose()

    // Now measure subsequent access
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

    update(store, {
      $set: {
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
      },
    })

    void total
    void effectRan
    void secondRan
    dispose()
  })
})

describe('Additional: Array Operations (Non-Reactive)', () => {
  bench('Array.push: 1000 items', () => {
    const [store] = createStore({ items: [] as number[] })
    for (let i = 0; i < 1000; i++) {
      store.items.push(i)
    }
  })

  bench('Array.pop: 1000 items', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    for (let i = 0; i < 1000; i++) {
      store.items.pop()
    }
  })

  bench('Array.shift: 1000 items', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    for (let i = 0; i < 1000; i++) {
      store.items.shift()
    }
  })

  bench('Array.unshift: 1000 items', () => {
    const [store] = createStore({ items: [] as number[] })
    for (let i = 0; i < 1000; i++) {
      store.items.unshift(i)
    }
  })

  bench('Array.splice: remove 500 from 1000', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    store.items.splice(250, 500)
  })

  bench('Array.splice: add 500 to 1000', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    const newItems = Array.from({ length: 500 }, (_, i) => i + 1000)
    store.items.splice(500, 0, ...newItems)
  })

  bench('Array.sort: 1000 items', () => {
    const initial = Array.from({ length: 1000 }, () => Math.random())
    const [store] = createStore({ items: initial })
    store.items.sort((a, b) => a - b)
  })
})

describe('Additional: Array Iteration Methods (Reactive)', () => {
  bench('Array.map: 1000 items, 10 times', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    effect(() => {
      // Benchmark the reactive read of the array
      for (let i = 0; i < 10; i++) {
        store.items.map(x => x * 2)
      }
    })
  })

  bench('Array.filter: 1000 items, 10 times', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    effect(() => {
      for (let i = 0; i < 10; i++) {
        store.items.filter(x => x % 2 === 0)
      }
    })
  })

  bench('Array.reduce: 1000 items, 10 times', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    effect(() => {
      for (let i = 0; i < 10; i++) {
        store.items.reduce((acc, x) => acc + x, 0)
      }
    })
  })

  bench('Array.find/findIndex: 1000 items, 100 times', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    effect(() => {
      for (let i = 0; i < 100; i++) {
        store.items.find(x => x === 50)
        store.items.findIndex(x => x === 50)
      }
    })
  })

  bench('Array.some/every: 1000 items, 100 times', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    effect(() => {
      for (let i = 0; i < 100; i++) {
        store.items.some(x => x % 2 === 0)
        store.items.every(x => x >= 0)
      }
    })
  })

  bench('Array.includes/indexOf: 1000 items, 100 times', () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i)
    const [store] = createStore({ items: initial })
    effect(() => {
      for (let i = 0; i < 100; i++) {
        store.items.includes(50)
        store.items.indexOf(50)
      }
    })
  })
})

describe('Additional: Complex Scenarios', () => {
  interface Row {
    id: number
    name: string
    value: number
    category: string
    selected: boolean
    visible: boolean
  }

  interface GridState {
    rows: Row[]
    sortColumn: keyof Row | null
    sortDirection: 'asc' | 'desc'
  }

  bench('Data Grid Simulation: 100 rows', () => {
    const [grid, setGrid] = createStore<GridState>({
      rows: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Row ${i}`,
        value: Math.random() * 1000,
        category: 'Category ' + (i % 10),
        selected: false,
        visible: true,
      })),
      sortColumn: null,
      sortDirection: 'asc',
    })

    let visibleRowCount = 0
    effect(() => {
      visibleRowCount = grid.rows.filter(r => r.visible).length
    })

    // Sort by value
    setGrid('rows', (rows: Row[]) =>
      [...rows].sort((a, b) => (a.value > b.value ? 1 : -1))
    )

    // Filter by category
    const categoryToFilter = 'Category 5'
    for (let i = 0; i < 100; i++) {
      const row = grid.rows[i]
      if (row) {
        row.visible = row.category === categoryToFilter
      }
    }

    // Bulk update values
    for (let i = 0; i < 50; i++) {
      const row = grid.rows[i]
      if (row) {
        row.value = row.value * 1.1
      }
    }

    // Toggle selection
    for (let i = 0; i < 100; i += 5) {
      const row = grid.rows[i]
      if (row) {
        row.selected = !row.selected
      }
    }
    void visibleRowCount
  })

  interface CartItem {
    id: number
    name: string
    price: number
    quantity: number
    discount: number
    subtotal: number
  }

  interface CartState {
    items: CartItem[]
    globalDiscount: number
    taxRate: number
    total: number
  }

  bench('Shopping Cart Simulation: 50 items', () => {
    const [cart, setCart] = createStore<CartState>({
      items: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `Product ${i}`,
        price: Math.random() * 100,
        quantity: 1,
        discount: 0,
        subtotal: 0,
      })),
      globalDiscount: 0,
      taxRate: 0.08,
      total: 0,
    })

    effect(() => {
      const subtotal = cart.items.reduce((acc, item) => acc + item.subtotal, 0)
      const discounted = subtotal * (1 - cart.globalDiscount)
      cart.total = discounted * (1 + cart.taxRate)
    })

    // Update quantities and calculate subtotals
    for (let i = 0; i < 50; i++) {
      const item = cart.items[i]
      if (item) {
        item.quantity = 2
        item.subtotal = item.price * item.quantity
      }
    }

    // Apply item-level discounts
    for (let i = 0; i < 25; i++) {
      const item = cart.items[i]
      if (item) {
        item.discount = 0.1 // 10% off
        item.subtotal = item.price * item.quantity * (1 - item.discount)
      }
    }

    // Apply global discount
    setCart('globalDiscount', 0.05) // 5% off everything

    // Remove some items
    setCart('items', (items: CartItem[]) => items.slice(0, 40))
  })

  interface TreeNode {
    id: string
    name: string
    selected: boolean
    children: TreeNode[]
  }

  bench('Tree Structure Simulation: 5 levels deep', () => {
    const createNode = (
      id: string,
      level: number,
      maxLevel: number
    ): TreeNode => ({
      id,
      name: `Node ${id}`,
      selected: false,
      children:
        level >= maxLevel
          ? []
          : Array.from({ length: 3 }, (_, i) =>
              createNode(`${id}-${i}`, level + 1, maxLevel)
            ),
    })

    const [tree] = createStore({ root: createNode('root', 1, 5) })

    // Count selected nodes reactively
    function countSelected(node: TreeNode): number {
      return (
        (node.selected ? 1 : 0) +
        node.children.reduce((acc, child) => acc + countSelected(child), 0)
      )
    }

    effect(() => {
      countSelected(tree.root)
    })

    // Toggle a deep node
    const deepNode = tree.root.children[0]?.children[1]?.children[2]
    if (deepNode) {
      deepNode.selected = true
    }

    // Collapse leaf nodes
    function collapseLeaves(node: TreeNode) {
      if (node.children.length === 0) {
        return
      }
      if (node.children.every(c => c.children.length === 0)) {
        node.children = []
      } else {
        node.children.forEach(collapseLeaves)
      }
    }
    collapseLeaves(tree.root)
  })
})

describe('Additional: Mixed Read/Write Loads', () => {
  bench('100 reads and 100 writes on a single property', () => {
    const [store, setStore] = createStore({ count: 0 })
    let effectRuns = 0

    const dispose = effect(() => {
      store.count
      effectRuns++
    })

    for (let i = 0; i < 100; i++) {
      setStore('count', i)
      store.count // Read after write
    }

    dispose()
  })
})

describe('Additional: Complex Object Structures', () => {
  interface User {
    id: number
    name: string
    profile: {
      email: string
      age: number
      settings: {
        theme: 'dark' | 'light'
        notifications: boolean
      }
    }
    posts: { id: number; title: string; likes: number }[]
  }

  bench('Nested object and array updates', () => {
    const [store, setStore] = createStore<User>({
      id: 1,
      name: 'John Doe',
      profile: {
        email: 'john@example.com',
        age: 30,
        settings: { theme: 'light', notifications: true },
      },
      posts: [
        { id: 1, title: 'First Post', likes: 10 },
        { id: 2, title: 'Second Post', likes: 25 },
      ],
    })

    let totalLikes = 0
    effect(() => {
      totalLikes = store.posts.reduce((acc, p) => acc + p.likes, 0)
    })

    // Update nested property
    setStore('profile', 'settings', 'theme', 'dark')

    // Add a new post
    setStore('posts', (posts: User['posts']) => [
      ...posts,
      { id: 3, title: 'Third Post', likes: 5 },
    ])

    // Update an item in the array
    setStore('posts', 0, 'likes', (l: number) => l + 1)

    // Replace a nested object
    setStore('user', 'profile', (profile: User['profile']) => ({
      ...profile,
      age: 31,
    }))
    void totalLikes
  })
})

describe('Additional: Circular Dependencies', () => {
  interface CircularNode {
    id: number
    value: number
    next: CircularNode | null
    prev: CircularNode | null
  }

  bench('Create and update circular list', () => {
    const [store] = createStore({
      nodes: Array.from(
        { length: 10 },
        (_, i): CircularNode => ({
          id: i,
          value: i,
          next: null,
          prev: null,
        })
      ),
    })

    // Link nodes circularly
    for (let i = 0; i < 10; i++) {
      const currentNode = store.nodes[i]
      const nextNode = store.nodes[(i + 1) % 10]
      const prevNode = store.nodes[(i + 9) % 10]
      if (currentNode && nextNode && prevNode) {
        currentNode.next = nextNode
        currentNode.prev = prevNode
      }
    }

    // Traverse and update
    let current = store.nodes[0]
    for (let i = 0; i < 100; i++) {
      if (current) {
        current.value += 1
        current = current.next! // We know it's not null in a circular list
      }
    }
  })
})
