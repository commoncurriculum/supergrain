/**
 * Proxy vs readLeaf vs class getter: reactive read comparison.
 *
 * Class getters are V8's sweet spot — inlined to near-bare-signal speed.
 * Function calls (readSignal/readLeaf) cannot be inlined by V8.
 */

import { bench, describe } from 'vitest'
import { createStore, readLeaf, unwrap, $NODE } from '../src'
import { effect, signal } from 'alien-signals'

const data = () => ({
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  dueDate: '2026-03-15',
  notes: 'Get 2% milk',
  createdAt: '2026-03-01',
  updatedAt: '2026-03-13',
})

// Class getter view — what the compiler should generate
class StoreView {
  _n: any
  constructor(raw: any) {
    const nodes = raw[$NODE] || (Object.defineProperty(raw, $NODE, { value: {}, enumerable: false, configurable: true }), raw[$NODE])
    for (const key of ['title', 'completed', 'dueDate', 'notes', 'createdAt', 'updatedAt']) {
      if (!nodes[key]) nodes[key] = signal(raw[key])
    }
    this._n = nodes
  }
  get title() { return this._n.title() }
  get completed() { return this._n.completed() }
  get dueDate() { return this._n.dueDate() }
  get notes() { return this._n.notes() }
  get createdAt() { return this._n.createdAt() }
  get updatedAt() { return this._n.updatedAt() }
}

// --- Reactive leaf reads ---

describe('Reactive Leaf Reads (100k inside effect)', () => {
  const [proxyStore] = createStore(data())
  const [leafStore] = createStore(data())

  const viewRaw = unwrap(createStore(data())[0]) as any
  const view = new StoreView(viewRaw)

  bench('proxy', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { proxyStore.title }
    })
    dispose()
  })

  bench('readLeaf', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { readLeaf(leafStore, 'title') }
    })
    dispose()
  })

  bench('class getter', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { view.title }
    })
    dispose()
  })

  bench('raw signal baseline', () => {
    const sig = signal('Buy milk')
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { sig() }
    })
    dispose()
  })
})

// --- Reactive updates ---

describe('Reactive Updates (1000 mutations)', () => {
  bench('proxy', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => { store.title })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('readLeaf', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => { readLeaf(store, 'title') })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('class getter', () => {
    const [store, update] = createStore(data())
    const raw = unwrap(store) as any
    const v = new StoreView(raw)
    const dispose = effect(() => { v.title })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })
})

// --- Component render: 6 leaf reads ---

describe('Component Render: 6 leaf reads (10k renders)', () => {
  const [proxyStore] = createStore(data())
  const [leafStore] = createStore(data())

  const viewRaw = unwrap(createStore(data())[0]) as any
  const view = new StoreView(viewRaw)

  bench('proxy', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        proxyStore.title; proxyStore.completed; proxyStore.dueDate
        proxyStore.notes; proxyStore.createdAt; proxyStore.updatedAt
      }
    })
    dispose()
  })

  bench('readLeaf', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        readLeaf(leafStore, 'title'); readLeaf(leafStore, 'completed'); readLeaf(leafStore, 'dueDate')
        readLeaf(leafStore, 'notes'); readLeaf(leafStore, 'createdAt'); readLeaf(leafStore, 'updatedAt')
      }
    })
    dispose()
  })

  bench('class getter', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        view.title; view.completed; view.dueDate
        view.notes; view.createdAt; view.updatedAt
      }
    })
    dispose()
  })
})

// --- Batched updates ---

describe('Batched Updates: 5 fields (1000 batches)', () => {
  bench('proxy', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => {
      store.title; store.completed; store.notes; store.dueDate; store.updatedAt
    })
    for (let i = 0; i < 1000; i++) {
      update({
        $set: { title: `T${i}`, completed: i % 2 === 0, notes: `N${i}`, dueDate: `D${i}`, updatedAt: `U${i}` },
      })
    }
    dispose()
  })

  bench('class getter', () => {
    const [store, update] = createStore(data())
    const raw = unwrap(store) as any
    const v = new StoreView(raw)
    const dispose = effect(() => {
      v.title; v.completed; v.notes; v.dueDate; v.updatedAt
    })
    for (let i = 0; i < 1000; i++) {
      update({
        $set: { title: `T${i}`, completed: i % 2 === 0, notes: `N${i}`, dueDate: `D${i}`, updatedAt: `U${i}` },
      })
    }
    dispose()
  })
})
