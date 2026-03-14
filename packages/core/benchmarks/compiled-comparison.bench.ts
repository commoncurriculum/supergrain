/**
 * Benchmarks comparing proxy reads vs compiled (readSignal) reads.
 *
 * "Compiled" means what the vite plugin actually produces:
 *   store.title  →  readSignal(store, 'title')
 *
 * readSignal reads the signal directly and wraps the result,
 * bypassing the proxy get trap.
 */

import { bench, describe } from 'vitest'
import { createStore, readSignal, unwrap } from '../src'
import { effect, signal as rawSignal, startBatch, endBatch } from 'alien-signals'

const data = () => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
  dueDate: '2026-03-15',
  notes: 'Get 2% milk',
  createdAt: '2026-03-01',
  updatedAt: '2026-03-13',
})

// --- Non-reactive leaf reads ---

describe('Non-reactive Leaf Reads (1M)', () => {
  const [store] = createStore(data())

  bench('proxy: store.title', () => {
    for (let i = 0; i < 1_000_000; i++) {
      store.title
    }
  })

  bench('compiled: readSignal(store, "title")', () => {
    for (let i = 0; i < 1_000_000; i++) {
      readSignal(store, 'title')
    }
  })

  const sig = rawSignal('Buy milk')
  bench('raw signal baseline', () => {
    for (let i = 0; i < 1_000_000; i++) {
      sig()
    }
  })
})

// --- Non-reactive nested reads ---

describe('Non-reactive Nested Reads (1M)', () => {
  const [store] = createStore(data())

  bench('proxy: store.assignee.name', () => {
    for (let i = 0; i < 1_000_000; i++) {
      store.assignee.name
    }
  })

  bench('compiled: readSignal(store.assignee, "name")', () => {
    for (let i = 0; i < 1_000_000; i++) {
      readSignal(store.assignee, 'name')
    }
  })
})

// --- Reactive leaf reads inside effect ---

describe('Reactive Leaf Reads (100k inside effect)', () => {
  const [proxyStore] = createStore(data())
  const [compiledStore] = createStore(data())

  bench('proxy', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        proxyStore.title
      }
    })
    dispose()
  })

  bench('compiled', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        readSignal(compiledStore, 'title')
      }
    })
    dispose()
  })

  bench('raw signal baseline', () => {
    const sig = rawSignal('Buy milk')
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        sig()
      }
    })
    dispose()
  })
})

// --- Reactive updates (effect re-runs) ---

describe('Reactive Updates (1000 mutations)', () => {
  bench('proxy', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => { store.title })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('compiled', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => { readSignal(store, 'title') })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })
})

// --- Component render simulation: reading 8 props ---

describe('Component Render: 8 prop reads (10k renders)', () => {
  const [proxyStore] = createStore(data())
  const [compiledStore] = createStore(data())

  bench('proxy', () => {
    for (let i = 0; i < 10_000; i++) {
      proxyStore.title
      proxyStore.completed
      proxyStore.assignee.name
      proxyStore.assignee.avatar
      proxyStore.dueDate
      proxyStore.notes
      proxyStore.createdAt
      proxyStore.updatedAt
    }
  })

  bench('compiled', () => {
    for (let i = 0; i < 10_000; i++) {
      readSignal(compiledStore, 'title')
      readSignal(compiledStore, 'completed')
      readSignal(readSignal(compiledStore, 'assignee'), 'name')
      readSignal(readSignal(compiledStore, 'assignee'), 'avatar')
      readSignal(compiledStore, 'dueDate')
      readSignal(compiledStore, 'notes')
      readSignal(compiledStore, 'createdAt')
      readSignal(compiledStore, 'updatedAt')
    }
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

  bench('compiled', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => {
      readSignal(store, 'title')
      readSignal(store, 'completed')
      readSignal(store, 'notes')
      readSignal(store, 'dueDate')
      readSignal(store, 'updatedAt')
    })
    for (let i = 0; i < 1000; i++) {
      update({
        $set: { title: `T${i}`, completed: i % 2 === 0, notes: `N${i}`, dueDate: `D${i}`, updatedAt: `U${i}` },
      })
    }
    dispose()
  })
})
