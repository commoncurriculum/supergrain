/**
 * Realistic benchmarks simulating React component patterns.
 *
 * In a React app:
 * - A component reads 5-20 properties during render
 * - A mutation fires, the effect triggers, React re-renders
 * - Multiple components exist, only affected ones should re-render
 *
 * We simulate "re-render" as an effect that reads a handful of properties.
 */

import { bench, describe } from 'vitest'
import { signal, computed, effect, startBatch, endBatch } from 'alien-signals'
import {
  signal as pSignal,
  computed as pComputed,
  effect as pEffect,
  batch as pBatch,
} from '@preact/signals-core'
import { createStore } from '../src'

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

// --- Simulate a component render: read several properties, then mutate one ---

describe('Component render cycle: read 8 props, mutate 1, re-render (1k cycles)', () => {
  bench('alien-signals: raw signals', () => {
    const title = signal('Buy milk')
    const completed = signal(false)
    const priority = signal('medium')
    const assigneeName = signal('Scott')
    const assigneeAvatar = signal('scott.png')
    const dueDate = signal('2026-03-15')
    const notes = signal('Get 2% milk')
    const updatedAt = signal('2026-03-13')

    const dispose = effect(() => {
      title(); completed(); priority(); assigneeName()
      assigneeAvatar(); dueDate(); notes(); updatedAt()
    })
    for (let i = 0; i < 1_000; i++) {
      title(`Title ${i}`)
    }
    dispose()
  })

  bench('alien-signals: computeds wrapping proxy (model approach)', () => {
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

  bench('preact: raw signals', () => {
    const title = pSignal('Buy milk')
    const completed = pSignal(false)
    const priority = pSignal('medium')
    const assigneeName = pSignal('Scott')
    const assigneeAvatar = pSignal('scott.png')
    const dueDate = pSignal('2026-03-15')
    const notes = pSignal('Get 2% milk')
    const updatedAt = pSignal('2026-03-13')

    const dispose = pEffect(() => {
      title.value; completed.value; priority.value; assigneeName.value
      assigneeAvatar.value; dueDate.value; notes.value; updatedAt.value
    })
    for (let i = 0; i < 1_000; i++) {
      title.value = `Title ${i}`
    }
    dispose()
  })
})

// --- Fine-grained: 10 "components", only 1 should re-render ---

describe('Fine-grained: 10 components, mutate 1 prop, 1k updates', () => {
  bench('alien-signals: computeds wrapping proxy (model approach)', () => {
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

    let renderCount = 0
    const disposes = computeds.map(c =>
      effect(() => { c(); renderCount++ })
    )

    renderCount = 0
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    // Only the title effect should have re-run (1000 times)
    disposes.forEach(d => d())
  })

  bench('createStore proxy (current)', () => {
    const [store, update] = createStore(makeData())

    let renderCount = 0
    const disposes = [
      effect(() => { store.title; renderCount++ }),
      effect(() => { store.completed; renderCount++ }),
      effect(() => { store.priority; renderCount++ }),
      effect(() => { store.assignee.name; renderCount++ }),
      effect(() => { store.assignee.avatar; renderCount++ }),
      effect(() => { store.dueDate; renderCount++ }),
      effect(() => { store.notes; renderCount++ }),
      effect(() => { store.updatedAt; renderCount++ }),
      effect(() => { store.createdAt; renderCount++ }),
      effect(() => { store.id; renderCount++ }),
    ]

    renderCount = 0
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    disposes.forEach(d => d())
  })

  bench('preact: raw signals', () => {
    const signals = {
      title: pSignal('Buy milk'),
      completed: pSignal(false),
      priority: pSignal('medium'),
      assigneeName: pSignal('Scott'),
      assigneeAvatar: pSignal('scott.png'),
      dueDate: pSignal('2026-03-15'),
      notes: pSignal('Get 2% milk'),
      updatedAt: pSignal('2026-03-13'),
      createdAt: pSignal('2026-03-01'),
      id: pSignal(1),
    }

    let renderCount = 0
    const disposes = Object.values(signals).map(s =>
      pEffect(() => { s.value; renderCount++ })
    )

    renderCount = 0
    for (let i = 0; i < 1_000; i++) {
      signals.title.value = `Title ${i}`
    }
    disposes.forEach(d => d())
  })
})

// --- Batched update: change 5 props at once, one re-render ---

describe('Batched update: change 5 props, 1 component re-render (1k batches)', () => {
  bench('alien-signals: computeds wrapping proxy (model approach)', () => {
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

  bench('preact: raw signals', () => {
    const title = pSignal('Buy milk')
    const completed = pSignal(false)
    const priority = pSignal('medium')
    const notes = pSignal('Get 2% milk')
    const updatedAt = pSignal('2026-03-13')

    const dispose = pEffect(() => {
      title.value; completed.value; priority.value; notes.value; updatedAt.value
    })
    for (let i = 0; i < 1_000; i++) {
      pBatch(() => {
        title.value = `Title ${i}`
        completed.value = i % 2 === 0
        priority.value = 'high'
        notes.value = `Note ${i}`
        updatedAt.value = `2026-03-${i % 28 + 1}`
      })
    }
    dispose()
  })
})
