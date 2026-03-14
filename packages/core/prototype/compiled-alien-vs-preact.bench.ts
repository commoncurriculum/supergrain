/**
 * Compiled approach: alien-signals store vs preact-signals store.
 *
 * Both use the SAME architecture:
 * - Proxy-based store with lazy signal creation
 * - Same operator/update path ($set, path resolution, etc.)
 * - computed() wrapping proxy reads (what the Vite plugin generates)
 * - Writes go through update() → proxy → setProperty → signal
 *
 * The ONLY difference is the signal primitive underneath:
 * - "compiled + alien" = createStore (alien-signals) + alien computed/effect
 * - "compiled + preact" = createPreactStore (preact-signals) + preact computed/effect
 *
 * Also includes solid-js/store as the benchmark to beat.
 */

import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { computed, effect, startBatch, endBatch } from 'alien-signals'
import { computed as pComputed, effect as pEffect } from '@preact/signals-core'
import { createPreactStore } from './preact-store'
import { createRoot, createEffect, batch } from 'solid-js/dist/solid.js'
import { createStore as createSolidStore } from 'solid-js/store/dist/store.js'

// ---------------------------------------------------------------------------
// Reactive reads: 10k reads of one property inside effect
// ---------------------------------------------------------------------------

describe('Reactive reads: 10k reads of one prop', () => {
  bench('compiled + alien', () => {
    const [store] = createStore({ value: 0 })
    const c = computed(() => store.value)
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) { c() }
    })
    dispose()
  })

  bench('compiled + preact', () => {
    const [store] = createPreactStore({ value: 0 })
    const c = pComputed(() => store.value)
    const dispose = pEffect(() => {
      for (let i = 0; i < 10_000; i++) { c.value }
    })
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store] = createSolidStore({ value: 0 })
      createEffect(() => {
        for (let i = 0; i < 10_000; i++) { store.value }
      })
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Deep reactive reads: 10k reads of nested path
// ---------------------------------------------------------------------------

describe('Deep reactive reads: 10k reads of nested prop', () => {
  bench('compiled + alien', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const c = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) { c() }
    })
    dispose()
  })

  bench('compiled + preact', () => {
    const [store] = createPreactStore({ l1: { l2: { l3: { value: 0 } } } })
    const c = pComputed(() => store.l1.l2.l3.value)
    const dispose = pEffect(() => {
      for (let i = 0; i < 10_000; i++) { c.value }
    })
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store] = createSolidStore({ l1: { l2: { l3: { value: 0 } } } })
      createEffect(() => {
        for (let i = 0; i < 10_000; i++) { store.l1.l2.l3.value }
      })
      dispose()
    })
  })
})

// ---------------------------------------------------------------------------
// Component render: read 8 props, mutate 1, 1k cycles
// ---------------------------------------------------------------------------

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

describe('Component render: read 8 props, mutate 1, 1k cycles', () => {
  bench('compiled + alien', () => {
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

  bench('compiled + preact', () => {
    const [store, update] = createPreactStore(makeData())
    const cTitle = pComputed(() => store.title)
    const cCompleted = pComputed(() => store.completed)
    const cPriority = pComputed(() => store.priority)
    const cAssigneeName = pComputed(() => store.assignee.name)
    const cAssigneeAvatar = pComputed(() => store.assignee.avatar)
    const cDueDate = pComputed(() => store.dueDate)
    const cNotes = pComputed(() => store.notes)
    const cUpdatedAt = pComputed(() => store.updatedAt)

    const dispose = pEffect(() => {
      cTitle.value; cCompleted.value; cPriority.value; cAssigneeName.value
      cAssigneeAvatar.value; cDueDate.value; cNotes.value; cUpdatedAt.value
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
  bench('compiled + alien', () => {
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

  bench('compiled + preact', () => {
    const [store, update] = createPreactStore(makeData())
    const computeds = [
      pComputed(() => store.title), pComputed(() => store.completed),
      pComputed(() => store.priority), pComputed(() => store.assignee.name),
      pComputed(() => store.assignee.avatar), pComputed(() => store.dueDate),
      pComputed(() => store.notes), pComputed(() => store.updatedAt),
      pComputed(() => store.createdAt), pComputed(() => store.id),
    ]
    const disposes = computeds.map(c => pEffect(() => { c.value }))
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
// Batched: change 5 props, 1 re-render, 1k batches
// ---------------------------------------------------------------------------

describe('Batched: change 5 props, 1 re-render, 1k batches', () => {
  bench('compiled + alien', () => {
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

  bench('compiled + preact', () => {
    const [store, update] = createPreactStore(makeData())
    const cTitle = pComputed(() => store.title)
    const cCompleted = pComputed(() => store.completed)
    const cPriority = pComputed(() => store.priority)
    const cNotes = pComputed(() => store.notes)
    const cUpdatedAt = pComputed(() => store.updatedAt)

    const dispose = pEffect(() => {
      cTitle.value; cCompleted.value; cPriority.value; cNotes.value; cUpdatedAt.value
    })
    for (let i = 0; i < 1_000; i++) {
      // update() already wraps in batch()
      update({ $set: { title: `Title ${i}`, completed: i % 2 === 0, priority: 'high', notes: `Note ${i}`, updatedAt: `2026-03-${i % 28 + 1}` } })
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
  bench('compiled + alien', () => {
    const [store, update] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const c = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => { c() })
    for (let i = 0; i < 100; i++) {
      update({ $set: { 'l1.l2.l3.value': i + 1 } })
    }
    dispose()
  })

  bench('compiled + preact', () => {
    const [store, update] = createPreactStore({ l1: { l2: { l3: { value: 0 } } } })
    const c = pComputed(() => store.l1.l2.l3.value)
    const dispose = pEffect(() => { c.value })
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
