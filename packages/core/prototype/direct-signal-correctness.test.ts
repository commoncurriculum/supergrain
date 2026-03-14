/**
 * Correctness tests for direct $NODE signal reads.
 *
 * The Vite plugin would compile:
 *   store.title → getNode(getNodes(raw), 'title', raw.title)()
 *
 * This bypasses the proxy entirely for reads.
 * Writes use setProperty() directly.
 * Dynamic access falls back to proxy (store[variable]).
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '../src'
import { setProperty, unwrap, $NODE } from '../src/store'
import { signal, effect, startBatch, endBatch } from 'alien-signals'

// Mirror core's getNodes/getNode using the SAME signal import
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

// ---------------------------------------------------------------------------
// 1. Basic: direct signal read is reactive
// ---------------------------------------------------------------------------

describe('Direct signal read: basic reactivity', () => {
  it('effect fires when property changes', () => {
    const [store] = createStore({ title: 'Buy milk' })
    const raw = unwrap(store) as any
    const nodes = getNodes(raw)
    const titleSignal = getNode(nodes, 'title', raw.title)

    let runs = 0
    let lastValue: string | undefined
    const dispose = effect(() => {
      runs++
      lastValue = titleSignal()
    })

    expect(runs).toBe(1)
    expect(lastValue).toBe('Buy milk')

    startBatch()
    setProperty(raw, 'title', 'New title')
    endBatch()

    expect(runs).toBe(2)
    expect(lastValue).toBe('New title')
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 2. Multiple mutations
// ---------------------------------------------------------------------------

describe('Direct signal read: multiple mutations', () => {
  it('1k mutations = 1k+1 effect runs', () => {
    const [store] = createStore({ title: 'start' })
    const raw = unwrap(store) as any
    const nodes = getNodes(raw)
    const titleSignal = getNode(nodes, 'title', raw.title)

    let runs = 0
    const dispose = effect(() => {
      runs++
      titleSignal()
    })

    expect(runs).toBe(1)
    for (let i = 0; i < 1_000; i++) {
      startBatch()
      setProperty(raw, 'title', `Title ${i}`)
      endBatch()
    }
    expect(runs).toBe(1_001)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 3. Fine-grained: only affected effect fires
// ---------------------------------------------------------------------------

describe('Direct signal read: fine-grained tracking', () => {
  it('mutating title only fires title effect', () => {
    const [store] = createStore({ title: 'Buy milk', priority: 'medium', notes: 'test' })
    const raw = unwrap(store) as any
    const nodes = getNodes(raw)
    const titleSignal = getNode(nodes, 'title', raw.title)
    const prioritySignal = getNode(nodes, 'priority', raw.priority)
    const notesSignal = getNode(nodes, 'notes', raw.notes)

    let titleRuns = 0, priorityRuns = 0, notesRuns = 0
    const d1 = effect(() => { titleRuns++; titleSignal() })
    const d2 = effect(() => { priorityRuns++; prioritySignal() })
    const d3 = effect(() => { notesRuns++; notesSignal() })

    expect(titleRuns).toBe(1)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    startBatch()
    setProperty(raw, 'title', 'New title')
    endBatch()

    expect(titleRuns).toBe(2)
    expect(priorityRuns).toBe(1)
    expect(notesRuns).toBe(1)

    d1(); d2(); d3()
  })
})

// ---------------------------------------------------------------------------
// 4. Batched: multiple writes = 1 effect re-run
// ---------------------------------------------------------------------------

describe('Direct signal read: batched updates', () => {
  it('5 changes in batch = 1 effect re-run', () => {
    const [store] = createStore({
      title: 'Buy milk', completed: false, priority: 'medium',
      notes: 'test', updatedAt: '2026-03-13',
    })
    const raw = unwrap(store) as any
    const nodes = getNodes(raw)
    const cTitle = getNode(nodes, 'title', raw.title)
    const cCompleted = getNode(nodes, 'completed', raw.completed)
    const cPriority = getNode(nodes, 'priority', raw.priority)
    const cNotes = getNode(nodes, 'notes', raw.notes)
    const cUpdatedAt = getNode(nodes, 'updatedAt', raw.updatedAt)

    let runs = 0
    const dispose = effect(() => {
      runs++
      cTitle(); cCompleted(); cPriority(); cNotes(); cUpdatedAt()
    })

    expect(runs).toBe(1)

    startBatch()
    setProperty(raw, 'title', 'New')
    setProperty(raw, 'completed', true)
    setProperty(raw, 'priority', 'high')
    setProperty(raw, 'notes', 'updated')
    setProperty(raw, 'updatedAt', '2026-03-14')
    endBatch()

    expect(runs).toBe(2)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 5. Deep nested: resolve path at compile time
// ---------------------------------------------------------------------------

describe('Direct signal read: deep nested', () => {
  it('nested signal updates correctly', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const raw = unwrap(store) as any
    const l3Raw = raw.l1.l2.l3
    const nodes = getNodes(l3Raw)
    const valueSignal = getNode(nodes, 'value', l3Raw.value)

    let lastValue: number | undefined
    const dispose = effect(() => { lastValue = valueSignal() })

    expect(lastValue).toBe(0)

    startBatch()
    setProperty(l3Raw, 'value', 99)
    endBatch()

    expect(lastValue).toBe(99)
    dispose()
  })
})

// ---------------------------------------------------------------------------
// 6. Proxy fallback: dynamic access still works
// ---------------------------------------------------------------------------

describe('Proxy fallback for dynamic access', () => {
  it('dynamic property access through proxy is reactive', () => {
    const [store, update] = createStore({ title: 'Buy milk', priority: 'medium' })

    const key = 'title' as string
    let runs = 0
    let lastValue: string | undefined
    const dispose = effect(() => {
      runs++
      lastValue = (store as any)[key]
    })

    expect(runs).toBe(1)
    expect(lastValue).toBe('Buy milk')

    update({ $set: { title: 'New title' } })
    expect(runs).toBe(2)
    expect(lastValue).toBe('New title')
    dispose()
  })

  it('compiled direct read and proxy fallback share the same signal', () => {
    const [store] = createStore({ title: 'Buy milk' })
    const raw = unwrap(store) as any

    // Force the proxy to create its signal first by reading through it
    let proxyValue: string | undefined
    const d1 = effect(() => { proxyValue = store.title })
    expect(proxyValue).toBe('Buy milk')

    // Now get the same signal directly from $NODE
    const nodes = getNodes(raw)
    const titleSignal = nodes['title'] // already created by proxy read above

    let directValue: string | undefined
    const d2 = effect(() => { directValue = titleSignal() })
    expect(directValue).toBe('Buy milk')

    // Update via setProperty — both should see the change
    startBatch()
    setProperty(raw, 'title', 'Updated')
    endBatch()

    expect(directValue).toBe('Updated')
    expect(proxyValue).toBe('Updated')

    d1(); d2()
  })

  it('direct signal created first, proxy read second — same signal', () => {
    const [store] = createStore({ title: 'Buy milk' })
    const raw = unwrap(store) as any
    const nodes = getNodes(raw)
    const titleSignal = getNode(nodes, 'title', raw.title)

    let directValue: string | undefined
    const d1 = effect(() => { directValue = titleSignal() })

    // Proxy read should find the existing signal (not create a new one)
    let proxyValue: string | undefined
    const d2 = effect(() => { proxyValue = store.title })

    expect(directValue).toBe('Buy milk')
    expect(proxyValue).toBe('Buy milk')

    // Update via compiled write
    startBatch()
    setProperty(raw, 'title', 'Updated')
    endBatch()

    expect(directValue).toBe('Updated')
    expect(proxyValue).toBe('Updated')

    d1(); d2()
  })
})
