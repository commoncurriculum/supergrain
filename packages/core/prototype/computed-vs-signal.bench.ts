/**
 * Benchmark: model's compiled read path vs raw signal baselines.
 * All reads are reactive (inside an effect) — the only case that matters.
 *
 * Compares:
 * - Plain object (absolute floor, no reactivity)
 * - preact/signals-core raw signal read (.value in effect)
 * - preact/signals-core computed read (.value in effect)
 * - alien-signals raw signal read (s() in effect)
 * - alien-signals computed wrapping proxy (the actual model architecture)
 * - createStore proxy (current approach, what we're trying to beat)
 */

import { bench, describe } from 'vitest'
import { signal, computed, effect } from 'alien-signals'
import { signal as pSignal, computed as pComputed, effect as pEffect } from '@preact/signals-core'
import { createStore } from '../src'

const data = () => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
})

// --- Reactive leaf reads ---

describe('Reactive Leaf Reads (100k inside effect)', () => {
  bench('plain object (floor)', () => {
    const obj = data()
    for (let i = 0; i < 100_000; i++) { obj.title }
  })

  bench('preact: raw signal', () => {
    const s = pSignal('Buy milk')
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { s.value }
    })
    dispose()
  })

  bench('preact: computed wrapping preact signal', () => {
    const s = pSignal('Buy milk')
    const c = pComputed(() => s.value)
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { c.value }
    })
    dispose()
  })

  bench('alien-signals: raw signal', () => {
    const s = signal('Buy milk')
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { s() }
    })
    dispose()
  })

  bench('alien-signals: computed wrapping alien signal', () => {
    const s = signal('Buy milk')
    const c = computed(() => s())
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { c() }
    })
    dispose()
  })

  bench('MODEL: alien computed wrapping proxy (proposed)', () => {
    const [store] = createStore(data())
    const c = computed(() => store.title)
    c() // force initial eval
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { c() }
    })
    dispose()
  })

  bench('createStore proxy (current)', () => {
    const [store] = createStore(data())
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { store.title }
    })
    dispose()
  })
})

// --- Reactive nested reads ---

describe('Reactive Nested Reads (100k inside effect)', () => {
  bench('plain object (floor)', () => {
    const obj = data()
    for (let i = 0; i < 100_000; i++) { obj.assignee.name }
  })

  bench('preact: raw signal', () => {
    const s = pSignal('Scott')
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { s.value }
    })
    dispose()
  })

  bench('preact: computed wrapping preact signal', () => {
    const s = pSignal('Scott')
    const c = pComputed(() => s.value)
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { c.value }
    })
    dispose()
  })

  bench('alien-signals: raw signal', () => {
    const s = signal('Scott')
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { s() }
    })
    dispose()
  })

  bench('alien-signals: computed wrapping alien signal', () => {
    const s = signal('Scott')
    const c = computed(() => s())
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { c() }
    })
    dispose()
  })

  bench('MODEL: alien computed wrapping proxy (proposed)', () => {
    const [store] = createStore(data())
    const c = computed(() => store.assignee.name)
    c() // force initial eval
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { c() }
    })
    dispose()
  })

  bench('createStore proxy (current)', () => {
    const [store] = createStore(data())
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { store.assignee.name }
    })
    dispose()
  })
})
