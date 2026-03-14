/**
 * Benchmark: per-read cost inside a reactive context.
 * This is what actually happens when you read a signal inside an effect.
 */

import { bench, describe } from 'vitest'
import { signal, computed, effect } from 'alien-signals'
import { signal as pSignal, computed as pComputed, effect as pEffect } from '@preact/signals-core'

describe('Single signal read inside effect (100k)', () => {
  bench('alien-signals: signal', () => {
    const s = signal(42)
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { s() }
    })
    dispose()
  })

  bench('alien-signals: computed wrapping signal', () => {
    const s = signal(42)
    const c = computed(() => s())
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { c() }
    })
    dispose()
  })

  bench('preact: signal', () => {
    const s = pSignal(42)
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { s.value }
    })
    dispose()
  })

  bench('preact: computed wrapping signal', () => {
    const s = pSignal(42)
    const c = pComputed(() => s.value)
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { c.value }
    })
    dispose()
  })
})

describe('Multiple different signals inside effect (10k x 10 signals)', () => {
  bench('alien-signals', () => {
    const signals = Array.from({ length: 10 }, (_, i) => signal(i))
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        for (const s of signals) { s() }
      }
    })
    dispose()
  })

  bench('preact', () => {
    const signals = Array.from({ length: 10 }, (_, i) => pSignal(i))
    const dispose = pEffect(() => {
      for (let i = 0; i < 10_000; i++) {
        for (const s of signals) { s.value }
      }
    })
    dispose()
  })
})

describe('Computed chain depth (read end of 10-deep computed chain, 100k)', () => {
  bench('alien-signals', () => {
    const s = signal(1)
    let c = computed(() => s())
    for (let i = 0; i < 9; i++) {
      const prev = c
      c = computed(() => prev())
    }
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) { c() }
    })
    dispose()
  })

  bench('preact', () => {
    const s = pSignal(1)
    let c = pComputed(() => s.value)
    for (let i = 0; i < 9; i++) {
      const prev = c
      c = pComputed(() => prev.value)
    }
    const dispose = pEffect(() => {
      for (let i = 0; i < 100_000; i++) { c.value }
    })
    dispose()
  })
})

describe('Propagation: 1 signal, 100 effects, 1k updates', () => {
  bench('alien-signals', () => {
    const s = signal(0)
    const disposes: (() => void)[] = []
    for (let i = 0; i < 100; i++) {
      disposes.push(effect(() => { s() }))
    }
    for (let i = 0; i < 1_000; i++) {
      s(i)
    }
    disposes.forEach(d => d())
  })

  bench('preact', () => {
    const s = pSignal(0)
    const disposes: (() => void)[] = []
    for (let i = 0; i < 100; i++) {
      disposes.push(pEffect(() => { s.value }))
    }
    for (let i = 0; i < 1_000; i++) {
      s.value = i
    }
    disposes.forEach(d => d())
  })
})
