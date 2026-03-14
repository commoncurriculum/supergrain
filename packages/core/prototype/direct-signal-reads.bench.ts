/**
 * Full compiled path: direct $NODE signal reads + direct setProperty writes.
 *
 * No proxy on reads. No operator parsing on writes. Just signals.
 *
 * The Vite plugin would emit:
 *   READ:  store.title → __sg_node(raw, 'title')()
 *   WRITE: update({$set:{title:'x'}}) → setProperty(raw, 'title', 'x')
 */

import { bench, describe } from 'vitest'
import { createStore } from '../src'
import { setProperty, unwrap, $NODE } from '../src/store'
import { signal, computed, effect, startBatch, endBatch } from 'alien-signals'
import { createRoot, createEffect, batch } from 'solid-js/dist/solid.js'
import { createStore as createSolidStore } from 'solid-js/store/dist/store.js'

// Mirrors core's getNodes/getNode — this is what the plugin runtime helper would be
function getNodes(target: object): Record<PropertyKey, any> {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    Object.defineProperty(target, $NODE, { value: {}, enumerable: false })
    nodes = (target as any)[$NODE]
  }
  return nodes
}

function getNode(nodes: Record<PropertyKey, any>, prop: PropertyKey, value?: any) {
  if (nodes[prop]) return nodes[prop]
  const s = signal(value) as any
  s.$ = s
  nodes[prop] = s
  return s
}

// Inline helper: what the compiled code would actually call
function sg(raw: any, prop: PropertyKey) {
  return getNode(getNodes(raw), prop, raw[prop])
}

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
  bench('direct signals (full compiled)', () => {
    const [store] = createStore(makeData())
    const raw = unwrap(store) as any
    const rawAssignee = raw.assignee
    // Plugin resolves these at build time
    const sTitle = sg(raw, 'title')
    const sCompleted = sg(raw, 'completed')
    const sPriority = sg(raw, 'priority')
    const sAssigneeName = sg(rawAssignee, 'name')
    const sAssigneeAvatar = sg(rawAssignee, 'avatar')
    const sDueDate = sg(raw, 'dueDate')
    const sNotes = sg(raw, 'notes')
    const sUpdatedAt = sg(raw, 'updatedAt')

    const dispose = effect(() => {
      sTitle(); sCompleted(); sPriority(); sAssigneeName()
      sAssigneeAvatar(); sDueDate(); sNotes(); sUpdatedAt()
    })
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      setProperty(raw, 'title', `Title ${i}`)
      endBatch()
    }
    dispose()
  })

  bench('computed reads + compiled writes', () => {
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

  bench('proxy only (current)', () => {
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
  bench('direct signals (full compiled)', () => {
    const [store] = createStore(makeData())
    const raw = unwrap(store) as any
    const rawAssignee = raw.assignee
    const signals = [
      sg(raw, 'title'), sg(raw, 'completed'), sg(raw, 'priority'),
      sg(rawAssignee, 'name'), sg(rawAssignee, 'avatar'),
      sg(raw, 'dueDate'), sg(raw, 'notes'), sg(raw, 'updatedAt'),
      sg(raw, 'createdAt'), sg(raw, 'id'),
    ]
    const disposes = signals.map(s => effect(() => { s() }))
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      setProperty(raw, 'title', `Title ${i}`)
      endBatch()
    }
    disposes.forEach(d => d())
  })

  bench('computed reads + compiled writes', () => {
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
// Batched: change 5 props, 1 re-render, 1k batches
// ---------------------------------------------------------------------------

describe('Batched: change 5 props, 1 re-render, 1k batches', () => {
  bench('direct signals (full compiled)', () => {
    const [store] = createStore(makeData())
    const raw = unwrap(store) as any
    const sTitle = sg(raw, 'title')
    const sCompleted = sg(raw, 'completed')
    const sPriority = sg(raw, 'priority')
    const sNotes = sg(raw, 'notes')
    const sUpdatedAt = sg(raw, 'updatedAt')

    const dispose = effect(() => {
      sTitle(); sCompleted(); sPriority(); sNotes(); sUpdatedAt()
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

  bench('computed reads + compiled writes', () => {
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
  bench('direct signals (full compiled)', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const raw = unwrap(store) as any
    const l3Raw = raw.l1.l2.l3
    const valueSignal = sg(l3Raw, 'value')

    const dispose = effect(() => { valueSignal() })
    for (let i = 0; i < 100; i++) {
      startBatch()
      setProperty(l3Raw, 'value', i + 1)
      endBatch()
    }
    dispose()
  })

  bench('computed reads + compiled writes', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const raw = unwrap(store) as any
    const c = computed(() => store.l1.l2.l3.value)
    const dispose = effect(() => { c() })
    const l3Raw = raw.l1.l2.l3
    for (let i = 0; i < 100; i++) {
      startBatch()
      setProperty(l3Raw, 'value', i + 1)
      endBatch()
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
