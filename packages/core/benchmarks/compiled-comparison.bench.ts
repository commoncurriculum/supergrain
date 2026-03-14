/**
 * Benchmarks comparing proxy reads vs compiled reads.
 *
 * The vite plugin produces:
 *   store.title (string)  →  readLeaf(store, 'title')   — no wrap, primitives
 *   store.user  (object)  →  readSignal(store, 'user')   — wrap, objects
 */

import { bench, describe } from 'vitest'
import { createStore, readSignal, readLeaf } from '../src'
import { effect, signal as rawSignal } from 'alien-signals'

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

// --- Reactive leaf reads inside effect ---

describe('Reactive Leaf Reads (100k inside effect)', () => {
  const [proxyStore] = createStore(data())
  const [leafStore] = createStore(data())

  bench('proxy', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        proxyStore.title
      }
    })
    dispose()
  })

  bench('readLeaf', () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        readLeaf(leafStore, 'title')
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

  bench('readLeaf', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => { readLeaf(store, 'title') })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })
})

// --- Component render simulation: reading 8 props ---

describe('Component Render: 8 prop reads (10k renders)', () => {
  const [proxyStore] = createStore(data())
  const [leafStore] = createStore(data())

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

  bench('compiled (readLeaf + readSignal)', () => {
    for (let i = 0; i < 10_000; i++) {
      readLeaf(leafStore, 'title')
      readLeaf(leafStore, 'completed')
      readLeaf(readSignal(leafStore, 'assignee'), 'name')
      readLeaf(readSignal(leafStore, 'assignee'), 'avatar')
      readLeaf(leafStore, 'dueDate')
      readLeaf(leafStore, 'notes')
      readLeaf(leafStore, 'createdAt')
      readLeaf(leafStore, 'updatedAt')
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

  bench('compiled (readLeaf)', () => {
    const [store, update] = createStore(data())
    const dispose = effect(() => {
      readLeaf(store, 'title')
      readLeaf(store, 'completed')
      readLeaf(store, 'notes')
      readLeaf(store, 'dueDate')
      readLeaf(store, 'updatedAt')
    })
    for (let i = 0; i < 1000; i++) {
      update({
        $set: { title: `T${i}`, completed: i % 2 === 0, notes: `N${i}`, dueDate: `D${i}`, updatedAt: `U${i}` },
      })
    }
    dispose()
  })
})
