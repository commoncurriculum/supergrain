/**
 * Correctness tests for each benchmark approach.
 * Validates that reactive tracking, propagation, and fine-grained updates
 * actually work before we trust the benchmark numbers.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '../src'
import { computed, effect, startBatch, endBatch } from 'alien-signals'
import {
  signal as pSignal,
  computed as pComputed,
  effect as pEffect,
  batch as pBatch,
} from '@preact/signals-core'

// ---------------------------------------------------------------------------
// 1. Basic reactive tracking: effect fires when value changes
// ---------------------------------------------------------------------------

describe('Basic reactive tracking', () => {
  it('compiled + alien: effect fires on mutation', () => {
    const [store, update] = createStore({ value: 0 })
    const c = computed(() => store.value)
    let runs = 0
    let lastValue: number | undefined
    const dispose = effect(() => {
      runs++
      lastValue = c()
    })
    expect(runs).toBe(1)
    expect(lastValue).toBe(0)

    update({ $set: { value: 42 } })
    expect(runs).toBe(2)
    expect(lastValue).toBe(42)
    dispose()
  })

  it('compiled + preact: effect fires on mutation', () => {
    const s = pSignal(0)
    const c = pComputed(() => s.value)
    let runs = 0
    let lastValue: number | undefined
    const dispose = pEffect(() => {
      runs++
      lastValue = c.value
    })
    expect(runs).toBe(1)
    expect(lastValue).toBe(0)

    s.value = 42
    expect(runs).toBe(2)
    expect(lastValue).toBe(42)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 2. Multiple mutations: effect fires for each
// ---------------------------------------------------------------------------

describe('Multiple mutations fire effects', () => {
  it('compiled + alien: 1k mutations = 1k+1 effect runs', () => {
    const [store, update] = createStore({ title: 'start' })
    const c = computed(() => store.title)
    let runs = 0
    const dispose = effect(() => {
      runs++
      c()
    })
    expect(runs).toBe(1)

    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    expect(runs).toBe(1_001)
    dispose()
  })

  it('compiled + preact: 1k mutations = 1k+1 effect runs', () => {
    const s = pSignal('start')
    const c = pComputed(() => s.value)
    let runs = 0
    const dispose = pEffect(() => {
      runs++
      c.value
    })
    expect(runs).toBe(1)

    for (let i = 0; i < 1_000; i++) {
      s.value = `Title ${i}`
    }
    expect(runs).toBe(1_001)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 3. Fine-grained: only the affected effect runs
// ---------------------------------------------------------------------------

describe('Fine-grained: only affected effect runs', () => {
  it('compiled + alien: mutating title only fires title effect', () => {
    const [store, update] = createStore({ title: 'Buy milk', priority: 'medium', notes: 'test' })
    const cTitle = computed(() => store.title)
    const cPriority = computed(() => store.priority)
    const cNotes = computed(() => store.notes)

    let titleRuns = 0, priorityRuns = 0, notesRuns = 0
    const d1 = effect(() => { titleRuns++; cTitle() })
    const d2 = effect(() => { priorityRuns++; cPriority() })
    const d3 = effect(() => { notesRuns++; cNotes() })

    expect(titleRuns).toBe(1)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    update({ $set: { title: 'New title' } })

    expect(titleRuns).toBe(2)
    expect(priorityRuns).toBe(1) // should NOT have re-run
    expect(notesRuns).toBe(1)    // should NOT have re-run

    d1(); d2(); d3()
  })

  it('compiled + preact: mutating title only fires title effect', () => {
    const title = pSignal('Buy milk')
    const priority = pSignal('medium')
    const notes = pSignal('test')
    const cTitle = pComputed(() => title.value)
    const cPriority = pComputed(() => priority.value)
    const cNotes = pComputed(() => notes.value)

    let titleRuns = 0, priorityRuns = 0, notesRuns = 0
    const d1 = pEffect(() => { titleRuns++; cTitle.value })
    const d2 = pEffect(() => { priorityRuns++; cPriority.value })
    const d3 = pEffect(() => { notesRuns++; cNotes.value })

    expect(titleRuns).toBe(1)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    title.value = 'New title'

    expect(titleRuns).toBe(2)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    d1(); d2(); d3()
  })
})

// ---------------------------------------------------------------------------
// 4. Batched updates: effect fires once for multiple changes
// ---------------------------------------------------------------------------

describe('Batched updates: effect fires once', () => {
  it('compiled + alien: batch of 5 changes = 1 effect re-run', () => {
    const [store, update] = createStore({
      title: 'Buy milk', completed: false, priority: 'medium',
      notes: 'test', updatedAt: '2026-03-13',
    })
    const cTitle = computed(() => store.title)
    const cCompleted = computed(() => store.completed)
    const cPriority = computed(() => store.priority)
    const cNotes = computed(() => store.notes)
    const cUpdatedAt = computed(() => store.updatedAt)

    let runs = 0
    const dispose = effect(() => {
      runs++
      cTitle(); cCompleted(); cPriority(); cNotes(); cUpdatedAt()
    })
    expect(runs).toBe(1)

    startBatch()
    update({ $set: { title: 'New', completed: true, priority: 'high', notes: 'updated', updatedAt: '2026-03-14' } })
    endBatch()

    expect(runs).toBe(2) // only 1 re-run, not 5
    dispose()
  })

  it('compiled + preact: batch of 5 changes = 1 effect re-run', () => {
    const title = pSignal('Buy milk')
    const completed = pSignal(false)
    const priority = pSignal('medium')
    const notes = pSignal('test')
    const updatedAt = pSignal('2026-03-13')

    const cTitle = pComputed(() => title.value)
    const cCompleted = pComputed(() => completed.value)
    const cPriority = pComputed(() => priority.value)
    const cNotes = pComputed(() => notes.value)
    const cUpdatedAt = pComputed(() => updatedAt.value)

    let runs = 0
    const dispose = pEffect(() => {
      runs++
      cTitle.value; cCompleted.value; cPriority.value; cNotes.value; cUpdatedAt.value
    })
    expect(runs).toBe(1)

    pBatch(() => {
      title.value = 'New'
      completed.value = true
      priority.value = 'high'
      notes.value = 'updated'
      updatedAt.value = '2026-03-14'
    })

    expect(runs).toBe(2)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 5. Deep nested: computed tracks through proxy correctly
// ---------------------------------------------------------------------------

describe('Deep nested tracking', () => {
  it('compiled + alien: deep computed updates on nested mutation', () => {
    const [store, update] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const c = computed(() => store.l1.l2.l3.value)
    let lastValue: number | undefined
    const dispose = effect(() => { lastValue = c() })
    expect(lastValue).toBe(0)

    update({ $set: { 'l1.l2.l3.value': 99 } })
    expect(lastValue).toBe(99)
    dispose()
  })

  it('compiled + preact: deep computed updates', () => {
    const value = pSignal(0)
    const c = pComputed(() => value.value)
    let lastValue: number | undefined
    const dispose = pEffect(() => { lastValue = c.value })
    expect(lastValue).toBe(0)

    value.value = 99
    expect(lastValue).toBe(99)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 6. Component render simulation: reading 8 props works correctly
// ---------------------------------------------------------------------------

describe('Component render: 8 props tracked correctly', () => {
  it('compiled + alien: all 8 values are readable and correct', () => {
    const [store, update] = createStore({
      title: 'Buy milk', completed: false, priority: 'medium',
      assignee: { name: 'Scott', avatar: 'scott.png' },
      dueDate: '2026-03-15', notes: 'Get 2% milk',
      createdAt: '2026-03-01', updatedAt: '2026-03-13',
    })
    const cTitle = computed(() => store.title)
    const cCompleted = computed(() => store.completed)
    const cPriority = computed(() => store.priority)
    const cAssigneeName = computed(() => store.assignee.name)
    const cAssigneeAvatar = computed(() => store.assignee.avatar)
    const cDueDate = computed(() => store.dueDate)
    const cNotes = computed(() => store.notes)
    const cUpdatedAt = computed(() => store.updatedAt)

    let values: any[] = []
    const dispose = effect(() => {
      values = [cTitle(), cCompleted(), cPriority(), cAssigneeName(),
                cAssigneeAvatar(), cDueDate(), cNotes(), cUpdatedAt()]
    })

    expect(values).toEqual([
      'Buy milk', false, 'medium', 'Scott',
      'scott.png', '2026-03-15', 'Get 2% milk', '2026-03-13',
    ])

    update({ $set: { title: 'New title' } })
    expect(values[0]).toBe('New title')
    expect(values[1]).toBe(false) // unchanged

    dispose()
  })

  it('compiled + preact: all 8 values are readable and correct', () => {
    const title = pSignal('Buy milk')
    const completed = pSignal(false)
    const priority = pSignal('medium')
    const assigneeName = pSignal('Scott')
    const assigneeAvatar = pSignal('scott.png')
    const dueDate = pSignal('2026-03-15')
    const notes = pSignal('Get 2% milk')
    const updatedAt = pSignal('2026-03-13')

    const cTitle = pComputed(() => title.value)
    const cCompleted = pComputed(() => completed.value)
    const cPriority = pComputed(() => priority.value)
    const cAssigneeName = pComputed(() => assigneeName.value)
    const cAssigneeAvatar = pComputed(() => assigneeAvatar.value)
    const cDueDate = pComputed(() => dueDate.value)
    const cNotes = pComputed(() => notes.value)
    const cUpdatedAt = pComputed(() => updatedAt.value)

    let values: any[] = []
    const dispose = pEffect(() => {
      values = [cTitle.value, cCompleted.value, cPriority.value, cAssigneeName.value,
                cAssigneeAvatar.value, cDueDate.value, cNotes.value, cUpdatedAt.value]
    })

    expect(values).toEqual([
      'Buy milk', false, 'medium', 'Scott',
      'scott.png', '2026-03-15', 'Get 2% milk', '2026-03-13',
    ])

    title.value = 'New title'
    expect(values[0]).toBe('New title')
    expect(values[1]).toBe(false)

    dispose()
  })
})
