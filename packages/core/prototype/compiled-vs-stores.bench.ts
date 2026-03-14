/**
 * Compiled (Vite plugin) approach vs createStore proxy vs solid-js.
 *
 * "Compiled" simulates what the Vite plugin does:
 * - At build time, each reactive property access becomes a computed() read
 * - Computeds are created once per component mount (setup cost)
 * - All subsequent reads are direct computed() calls — no proxy traversal
 * - Writes still go through update() (proxy path)
 */

import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { computed, effect, startBatch, endBatch } from 'alien-signals'
import { createRoot, createEffect, batch } from 'solid-js/dist/solid.js'
import { createStore as createSolidStore } from 'solid-js/store/dist/store.js'

// ---------------------------------------------------------------------------
// Reactive Effect Creation: 10k reads inside an effect
// ---------------------------------------------------------------------------

describe('Reactive reads: 10k reads of one property inside effect', () => {
  bench('compiled (vite plugin)', () => {
    const [store] = createStore({ value: 0 })
    const cValue = computed(() => store.value)
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) { cValue() }
    })
    dispose()
  })

  bench('createStore proxy (current)', () => {
    const [store] = createStore({ value: 0 })
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) { store.value }
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
// Deep property reads: nested path, 10k reads
// ---------------------------------------------------------------------------

describe('Deep reactive reads: 10k reads of l1.l2.l3.value', () => {
  bench('compiled (vite plugin)', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const cDeep = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) { cDeep() }
    })
    dispose()
  })

  bench('createStore proxy (current)', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) { store.l1.l2.l3.value }
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
// Component render cycle: read 8 props, mutate 1, re-render (1k cycles)
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
  bench('compiled (vite plugin)', () => {
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

  bench('createStore proxy (current)', () => {
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
// Fine-grained: 10 components, mutate 1 prop, only 1 should re-render
// ---------------------------------------------------------------------------

describe('Fine-grained: 10 components, mutate 1 prop, 1k updates', () => {
  bench('compiled (vite plugin)', () => {
    const [store, update] = createStore(makeData())
    const computeds = [
      computed(() => store.title),
      computed(() => store.completed),
      computed(() => store.priority),
      computed(() => store.assignee.name),
      computed(() => store.assignee.avatar),
      computed(() => store.dueDate),
      computed(() => store.notes),
      computed(() => store.updatedAt),
      computed(() => store.createdAt),
      computed(() => store.id),
    ]

    const disposes = computeds.map(c => effect(() => { c() }))

    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    disposes.forEach(d => d())
  })

  bench('createStore proxy (current)', () => {
    const [store, update] = createStore(makeData())

    const disposes = [
      effect(() => { store.title }),
      effect(() => { store.completed }),
      effect(() => { store.priority }),
      effect(() => { store.assignee.name }),
      effect(() => { store.assignee.avatar }),
      effect(() => { store.dueDate }),
      effect(() => { store.notes }),
      effect(() => { store.updatedAt }),
      effect(() => { store.createdAt }),
      effect(() => { store.id }),
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
// Deep updates: 100 nested property updates with reactive subscriber
// ---------------------------------------------------------------------------

describe('Deep updates: 100 nested updates, 1 reactive subscriber', () => {
  bench('compiled (vite plugin)', () => {
    const [store, update] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const cDeep = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => { cDeep() })
    for (let i = 0; i < 100; i++) {
      update({ $set: { 'l1.l2.l3.value': i + 1 } })
    }
    dispose()
  })

  bench('createStore proxy (current)', () => {
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

// ---------------------------------------------------------------------------
// Batched update: change 5 props at once, 1 component re-render (1k batches)
// ---------------------------------------------------------------------------

describe('Batched: change 5 props, 1 re-render, 1k batches', () => {
  bench('compiled (vite plugin)', () => {
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

  bench('createStore proxy (current)', () => {
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
// Row operations: select row in 1k row table
// ---------------------------------------------------------------------------

const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint']
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange']
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger']
const _random = (max: number) => Math.round(Math.random() * 1000) % max

const buildRows = (count = 1000) =>
  Array.from({ length: count }, (_, i) => ({
    id: i,
    label: `${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${nouns[_random(nouns.length)]}`,
  }))

describe('Row select: 1k rows, select one row', () => {
  bench('compiled (vite plugin)', () => {
    const [store, update] = createStore({ data: buildRows(), selected: null as number | null })
    const cSelected = computed(() => store.selected)
    const dispose = effect(() => { cSelected() })
    update({ $set: { selected: store.data[500].id } })
    dispose()
  })

  bench('createStore proxy (current)', () => {
    const [store, update] = createStore({ data: buildRows(), selected: null as number | null })
    const dispose = effect(() => { store.selected })
    update({ $set: { selected: store.data[500].id } })
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store, setStore] = createSolidStore({ data: buildRows(), selected: null as number | null })
      createEffect(() => { store.selected })
      setStore('selected', store.data[500].id)
      dispose()
    })
  })
})

describe('Row swap: 1k rows, swap 2 rows', () => {
  bench('compiled (vite plugin)', () => {
    const [store, update] = createStore({ data: buildRows() })
    const cLabel1 = computed(() => store.data[1]?.label)
    const dispose = effect(() => { cLabel1() })
    const row1 = store.data[1]
    const row998 = store.data[998]
    update({ $set: { 'data.1': row998, 'data.998': row1 } })
    dispose()
  })

  bench('createStore proxy (current)', () => {
    const [store, update] = createStore({ data: buildRows() })
    const dispose = effect(() => { store.data[1]?.label })
    const row1 = store.data[1]
    const row998 = store.data[998]
    update({ $set: { 'data.1': row998, 'data.998': row1 } })
    dispose()
  })

  bench('solid-js/store', () => {
    createRoot((dispose: () => void) => {
      const [store, setStore] = createSolidStore({ data: buildRows() })
      createEffect(() => { store.data[1]?.label })
      const row1 = { ...store.data[1] }
      const row998 = { ...store.data[998] }
      setStore('data', 1, row998)
      setStore('data', 998, row1)
      dispose()
    })
  })
})
