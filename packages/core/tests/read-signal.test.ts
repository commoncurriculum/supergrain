import { describe, it, expect } from 'vitest'
import { createStore, unwrap, readSignal, setProperty, effect, startBatch, endBatch } from '../src'

// 1. Basic reactivity
describe('readSignal: basic reactivity', () => {
  it('effect fires when property changes', () => {
    const [store] = createStore({ title: 'Buy milk' })
    const raw = unwrap(store) as any

    let runs = 0
    let lastValue: string | undefined
    const dispose = effect(() => {
      runs++
      lastValue = readSignal(raw, 'title')
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

// 2. Multiple mutations
describe('readSignal: multiple mutations', () => {
  it('1k mutations = 1k+1 effect runs', () => {
    const [store] = createStore({ title: 'start' })
    const raw = unwrap(store) as any

    let runs = 0
    const dispose = effect(() => {
      runs++
      readSignal(raw, 'title')
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

// 3. Fine-grained tracking
describe('readSignal: fine-grained tracking', () => {
  it('mutating title only fires title effect', () => {
    const [store] = createStore({ title: 'Buy milk', priority: 'medium', notes: 'test' })
    const raw = unwrap(store) as any

    let titleRuns = 0, priorityRuns = 0, notesRuns = 0
    const d1 = effect(() => { titleRuns++; readSignal(raw, 'title') })
    const d2 = effect(() => { priorityRuns++; readSignal(raw, 'priority') })
    const d3 = effect(() => { notesRuns++; readSignal(raw, 'notes') })

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

// 4. Batched updates
describe('readSignal: batched updates', () => {
  it('5 changes in batch = 1 effect re-run', () => {
    const [store] = createStore({
      title: 'Buy milk', completed: false, priority: 'medium',
      notes: 'test', updatedAt: '2026-03-13',
    })
    const raw = unwrap(store) as any

    let runs = 0
    const dispose = effect(() => {
      runs++
      readSignal(raw, 'title')
      readSignal(raw, 'completed')
      readSignal(raw, 'priority')
      readSignal(raw, 'notes')
      readSignal(raw, 'updatedAt')
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

// 5. Deep nested
describe('readSignal: deep nested', () => {
  it('nested signal updates correctly', () => {
    const [store] = createStore({ l1: { l2: { l3: { value: 0 } } } })
    const raw = unwrap(store) as any
    const l3Raw = raw.l1.l2.l3

    let lastValue: number | undefined
    const dispose = effect(() => { lastValue = readSignal(l3Raw, 'value') })

    expect(lastValue).toBe(0)

    startBatch()
    setProperty(l3Raw, 'value', 99)
    endBatch()

    expect(lastValue).toBe(99)
    dispose()
  })
})

// 6. Proxy fallback and signal sharing
describe('readSignal: proxy interop', () => {
  it('compiled direct read and proxy fallback share the same signal', () => {
    const [store] = createStore({ title: 'Buy milk' })
    const raw = unwrap(store) as any

    // Force the proxy to create its signal first
    let proxyValue: string | undefined
    const d1 = effect(() => { proxyValue = store.title })
    expect(proxyValue).toBe('Buy milk')

    // readSignal should find the existing signal
    let directValue: string | undefined
    const d2 = effect(() => { directValue = readSignal(raw, 'title') })
    expect(directValue).toBe('Buy milk')

    // Update — both should see the change
    startBatch()
    setProperty(raw, 'title', 'Updated')
    endBatch()

    expect(directValue).toBe('Updated')
    expect(proxyValue).toBe('Updated')

    d1(); d2()
  })

  it('readSignal created first, proxy read second — same signal', () => {
    const [store] = createStore({ title: 'Buy milk' })
    const raw = unwrap(store) as any

    let directValue: string | undefined
    const d1 = effect(() => { directValue = readSignal(raw, 'title') })

    let proxyValue: string | undefined
    const d2 = effect(() => { proxyValue = store.title })

    expect(directValue).toBe('Buy milk')
    expect(proxyValue).toBe('Buy milk')

    startBatch()
    setProperty(raw, 'title', 'Updated')
    endBatch()

    expect(directValue).toBe('Updated')
    expect(proxyValue).toBe('Updated')

    d1(); d2()
  })

  it('readSignal works with proxy (not just raw)', () => {
    const [store] = createStore({ title: 'Buy milk' })
    // Pass the proxy directly — readSignal calls unwrap() internally

    let lastValue: string | undefined
    const dispose = effect(() => { lastValue = readSignal(store, 'title') })
    expect(lastValue).toBe('Buy milk')

    startBatch()
    setProperty(unwrap(store) as any, 'title', 'Updated')
    endBatch()

    expect(lastValue).toBe('Updated')
    dispose()
  })
})
