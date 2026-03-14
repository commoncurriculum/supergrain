/**
 * Full compiled path: compiled reads AND compiled writes.
 *
 * "compiled reads only" = computed() reads + update({ $set: {...} }) writes
 * "compiled reads+writes" = computed() reads + direct setProperty() writes
 *
 * The Vite plugin would rewrite:
 *   READS:  store.title        → store[$SIGNALS].title()
 *   WRITES: update({ $set: { title: 'x' } }) → setProperty(raw, 'title', 'x')
 *
 * This eliminates operator parsing AND path resolution on every write.
 */

import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { setProperty, unwrap } from '../src/store'
import { computed, effect, startBatch, endBatch } from 'alien-signals'
import { computed as pComputed, effect as pEffect } from '@preact/signals-core'
import { createPreactStore } from './preact-store'
import { createRoot, createEffect, batch } from 'solid-js/dist/solid.js'
import { createStore as createSolidStore } from 'solid-js/store/dist/store.js'

const makeData = () => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  priority: 'medium',
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery', 'errands'],
  dueDate: '2026-03-15',
  notes: 'Get 2% milk',
  createdAt: '2026-03-01',
  updatedAt: '2026-03-13',
})

// ---------------------------------------------------------------------------
// Component render: read 8 props, mutate 1, 1k cycles
// ---------------------------------------------------------------------------

describe('Component render: read 8 props, mutate 1, 1k cycles', () => {
  bench('compiled reads+writes (alien)', () => {
    const [store] = createStore(makeData())
    const raw = unwrap(store)
    const cTitle = computed(() => store.title)
    const cCompleted = computed(() => store.completed)
    const cPriority = computed(() => store.priority)
    const cAssigneeName = computed(() => store.assignee.name)
    const cAssigneeAvatar = computed(() => store.assignee.avatar)
    const cDueDate = computed(() => store.dueDate)
    const cNotes = computed(() => store.notes)
    const cUpdatedAt = computed(() => store.updatedAt)

    const dispose = effect(() => {
      cTitle(); cCompleted(); cPriority(); cAssigneeName()
      cAssigneeAvatar(); cDueDate(); cNotes(); cUpdatedAt()
    })
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      setProperty(raw, 'title', `Title ${i}`)
      endBatch()
    }
    dispose()
  })

  bench('compiled reads only (alien)', () => {
    const [store, update] = createStore(makeData())
    const cTitle = computed(() => store.title)
    const cCompleted = computed(() => store.completed)
    const cPriority = computed(() => store.priority)
    const cAssigneeName = computed(() => store.assignee.name)
    const cAssigneeAvatar = computed(() => store.assignee.avatar)
    const cDueDate = computed(() => store.dueDate)
    const cNotes = computed(() => store.notes)
    const cUpdatedAt = computed(() => store.updatedAt)

    const dispose = effect(() => {
      cTitle(); cCompleted(); cPriority(); cAssigneeName()
      cAssigneeAvatar(); cDueDate(); cNotes(); cUpdatedAt()
    })
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('proxy only (current, no compilation)', () => {
    const [store, update] = createStore(makeData())
    const dispose = effect(() => {
      store.title; store.completed; store.priority; store.assignee.name
      store.assignee.avatar; store.dueDate; store.notes; store.updatedAt
    })
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store, setStore] = createSolidStore(makeData())
      createEffect(() => {
        store.title; store.completed; store.priority; store.assignee.name
        store.assignee.avatar; store.dueDate; store.notes; store.updatedAt
      })
      for (let i = 0; i < 1_000; i++) {
        setStore('title', `Title ${i}`)
      }
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Fine-grained: 10 components, mutate 1 prop, 1k updates
// ---------------------------------------------------------------------------

describe('Fine-grained: 10 components, mutate 1 prop, 1k updates', () => {
  bench('compiled reads+writes (alien)', () => {
    const [store] = createStore(makeData())
    const raw = unwrap(store)
    const computeds = [
      computed(() => store.title), computed(() => store.completed),
      computed(() => store.priority), computed(() => store.assignee.name),
      computed(() => store.assignee.avatar), computed(() => store.dueDate),
      computed(() => store.notes), computed(() => store.updatedAt),
      computed(() => store.createdAt), computed(() => store.id),
    ]
    const disposes = computeds.map(c => effect(() => { c() }))
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      setProperty(raw, 'title', `Title ${i}`)
      endBatch()
    }
    disposes.forEach(d => d())
  })

  bench('compiled reads only (alien)', () => {
    const [store, update] = createStore(makeData())
    const computeds = [
      computed(() => store.title), computed(() => store.completed),
      computed(() => store.priority), computed(() => store.assignee.name),
      computed(() => store.assignee.avatar), computed(() => store.dueDate),
      computed(() => store.notes), computed(() => store.updatedAt),
      computed(() => store.createdAt), computed(() => store.id),
    ]
    const disposes = computeds.map(c => effect(() => { c() }))
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    disposes.forEach(d => d())
  })

  bench('proxy only (current)', () => {
    const [store, update] = createStore(makeData())
    const disposes = [
      effect(() => { store.title }), effect(() => { store.completed }),
      effect(() => { store.priority }), effect(() => { store.assignee.name }),
      effect(() => { store.assignee.avatar }), effect(() => { store.dueDate }),
      effect(() => { store.notes }), effect(() => { store.updatedAt }),
      effect(() => { store.createdAt }), effect(() => { store.id }),
    ]
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    disposes.forEach(d => d())
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store, setStore] = createSolidStore(makeData())
      createEffect(() => { store.title })
      createEffect(() => { store.completed })
      createEffect(() => { store.priority })
      createEffect(() => { store.assignee.name })
      createEffect(() => { store.assignee.avatar })
      createEffect(() => { store.dueDate })
      createEffect(() => { store.notes })
      createEffect(() => { store.updatedAt })
      createEffect(() => { store.createdAt })
      createEffect(() => { store.id })
      for (let i = 0; i < 1_000; i++) {
        setStore('title', `Title ${i}`)
      }
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Batched: change 5 props at once, 1 re-render, 1k batches
// ---------------------------------------------------------------------------

describe('Batched: change 5 props, 1 re-render, 1k batches', () => {
  bench('compiled reads+writes (alien)', () => {
    const [store] = createStore(makeData())
    const raw = unwrap(store)
    const cTitle = computed(() => store.title)
    const cCompleted = computed(() => store.completed)
    const cPriority = computed(() => store.priority)
    const cNotes = computed(() => store.notes)
    const cUpdatedAt = computed(() => store.updatedAt)

    const dispose = effect(() => {
      cTitle(); cCompleted(); cPriority(); cNotes(); cUpdatedAt()
    })
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      setProperty(raw, 'title', `Title ${i}`)
      setProperty(raw, 'completed', i % 2 === 0)
      setProperty(raw, 'priority', 'high')
      setProperty(raw, 'notes', `Note ${i}`)
      setProperty(raw, 'updatedAt', `2026-03-${i % 28 + 1}`)
      endBatch()
    }
    dispose()
  })

  bench('compiled reads only (alien)', () => {
    const [store, update] = createStore(makeData())
    const cTitle = computed(() => store.title)
    const cCompleted = computed(() => store.completed)
    const cPriority = computed(() => store.priority)
    const cNotes = computed(() => store.notes)
    const cUpdatedAt = computed(() => store.updatedAt)

    const dispose = effect(() => {
      cTitle(); cCompleted(); cPriority(); cNotes(); cUpdatedAt()
    })
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      update({ $set: { title: `Title ${i}`, completed: i % 2 === 0, priority: 'high', notes: `Note ${i}`, updatedAt: `2026-03-${i % 28 + 1}` } })
      endBatch()
    }
    dispose()
  })

  bench('proxy only (current)', () => {
    const [store, update] = createStore(makeData())
    const dispose = effect(() => {
      store.title; store.completed; store.priority; store.notes; store.updatedAt
    })
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      update({ $set: { title: `Title ${i}`, completed: i % 2 === 0, priority: 'high', notes: `Note ${i}`, updatedAt: `2026-03-${i % 28 + 1}` } })
      endBatch()
    }
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store, setStore] = createSolidStore(makeData())
      createEffect(() => {
        store.title; store.completed; store.priority; store.notes; store.updatedAt
      })
      for (let i = 0; i < 1_000; i++) {
        batch(() => {
          setStore('title', `Title ${i}`)
          setStore('completed', i % 2 === 0)
          setStore('priority', 'high')
          setStore('notes', `Note ${i}`)
          setStore('updatedAt', `2026-03-${i % 28 + 1}`)
        })
      }
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Deep updates: 100 nested property updates
// ---------------------------------------------------------------------------

describe('Deep updates: 100 nested updates, 1 subscriber', () => {
  bench('compiled reads+writes (alien)', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const raw = unwrap(store)
    const c = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => { c() })
    // Compiled write resolves the nested path at build time
    const l3 = raw.l1.l2.l3
    for (let i = 0; i < 100; i++) {
      startBatch()
      setProperty(l3, 'value', i + 1)
      endBatch()
    }
    dispose()
  })

  bench('compiled reads only (alien)', () => {
    const [store, update] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const c = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => { c() })
    for (let i = 0; i < 100; i++) {
      update({ $set: { 'l1.l2.l3.value': i + 1 } })
    }
    dispose()
  })

  bench('proxy only (current)', () => {
    const [store, update] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const dispose = effect(() => { store.l1.l2.l3.value })
    for (let i = 0; i < 100; i++) {
      update({ $set: { 'l1.l2.l3.value': i + 1 } })
    }
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store, setStore] = createSolidStore({ l1: { l2: { l3: { value: 0 } } } })
      createEffect(() => { store.l1.l2.l3.value })
      for (let i = 0; i < 100; i++) {
        setStore('l1', 'l2', 'l3', 'value', i + 1)
      }
      dispose()
    })
  })
})
