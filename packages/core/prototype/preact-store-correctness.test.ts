/**
 * Correctness tests for the preact-backed store.
 * Must pass the same tests as alien-signals createStore.
 */

import { describe, it, expect } from 'vitest'
import { computed as pComputed, effect as pEffect, batch as pBatch } from '@preact/signals-core'
import { createPreactStore } from './preact-store'

describe('preact-store: basic reactive tracking', () => {
  it('effect fires on mutation', () => {
    const [store, update] = createPreactStore({ value: 0 })

    const c = pComputed(() => store.value)
    let runs = 0
    let lastValue: number | undefined
    const dispose = pEffect(() => {
      runs++
      lastValue = c.value
    })


    expect(runs).toBe(1)
    expect(lastValue).toBe(0)

    update({ $set: { value: 42 } })
    expect(runs).toBe(2)
    expect(lastValue).toBe(42)
    dispose()
  })
})

describe('preact-store: multiple mutations', () => {
  it('1k mutations = 1k+1 effect runs', () => {
    const [store, update] = createPreactStore({ title: 'start' })

    const c = pComputed(() => store.title)
    let runs = 0
    const dispose = pEffect(() => {
      runs++
      c.value
    })


    expect(runs).toBe(1)
    for (let i = 0; i < 1_000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    expect(runs).toBe(1_001)
    dispose()
  })
})

describe('preact-store: fine-grained tracking', () => {
  it('mutating title only fires title effect', () => {
    const [store, update] = createPreactStore({ title: 'Buy milk', priority: 'medium', notes: 'test' })

    const cTitle = pComputed(() => store.title)
    const cPriority = pComputed(() => store.priority)
    const cNotes = pComputed(() => store.notes)

    let titleRuns = 0, priorityRuns = 0, notesRuns = 0
    const d1 = pEffect(() => { titleRuns++; cTitle.value })
    const d2 = pEffect(() => { priorityRuns++; cPriority.value })
    const d3 = pEffect(() => { notesRuns++; cNotes.value })


    expect(titleRuns).toBe(1)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    update({ $set: { title: 'New title' } })

    expect(titleRuns).toBe(2)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    d1(); d2(); d3()
  })
})

describe('preact-store: batched updates', () => {
  it('batch of 5 changes = 1 effect re-run', () => {
    const [store, update] = createPreactStore({
      title: 'Buy milk', completed: false, priority: 'medium',
      notes: 'test', updatedAt: '2026-03-13',
    })

    const cTitle = pComputed(() => store.title)
    const cCompleted = pComputed(() => store.completed)
    const cPriority = pComputed(() => store.priority)
    const cNotes = pComputed(() => store.notes)
    const cUpdatedAt = pComputed(() => store.updatedAt)

    let runs = 0
    const dispose = pEffect(() => {
      runs++
      cTitle.value; cCompleted.value; cPriority.value; cNotes.value; cUpdatedAt.value
    })


    expect(runs).toBe(1)

    // update() already calls batch() internally
    update({ $set: { title: 'New', completed: true, priority: 'high', notes: 'updated', updatedAt: '2026-03-14' } })

    expect(runs).toBe(2) // only 1 re-run, not 5
    dispose()
  })
})

describe('preact-store: deep nested tracking', () => {
  it('deep computed updates on nested mutation', () => {
    const [store, update] = createPreactStore({ l1: { l2: { l3: { value: 0 } } } })

    const c = pComputed(() => store.l1.l2.l3.value)
    let lastValue: number | undefined
    const dispose = pEffect(() => { lastValue = c.value })


    expect(lastValue).toBe(0)
    update({ $set: { 'l1.l2.l3.value': 99 } })
    expect(lastValue).toBe(99)
    dispose()
  })
})

describe('preact-store: 8 props component render', () => {
  it('all values readable and update correctly', () => {
    const [store, update] = createPreactStore({
      title: 'Buy milk', completed: false, priority: 'medium',
      assignee: { name: 'Scott', avatar: 'scott.png' },
      dueDate: '2026-03-15', notes: 'Get 2% milk',
      createdAt: '2026-03-01', updatedAt: '2026-03-13',
    })

    const cTitle = pComputed(() => store.title)
    const cCompleted = pComputed(() => store.completed)
    const cPriority = pComputed(() => store.priority)
    const cAssigneeName = pComputed(() => store.assignee.name)
    const cAssigneeAvatar = pComputed(() => store.assignee.avatar)
    const cDueDate = pComputed(() => store.dueDate)
    const cNotes = pComputed(() => store.notes)
    const cUpdatedAt = pComputed(() => store.updatedAt)

    let values: any[] = []
    const dispose = pEffect(() => {
      values = [cTitle.value, cCompleted.value, cPriority.value, cAssigneeName.value,
                cAssigneeAvatar.value, cDueDate.value, cNotes.value, cUpdatedAt.value]
    })


    expect(values).toEqual([
      'Buy milk', false, 'medium', 'Scott',
      'scott.png', '2026-03-15', 'Get 2% milk', '2026-03-13',
    ])

    update({ $set: { title: 'New title' } })
    expect(values[0]).toBe('New title')
    expect(values[1]).toBe(false)

    dispose()
  })
})
