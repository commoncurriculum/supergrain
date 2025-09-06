import { describe, it, expect } from 'vitest'
import { createStore, effect } from '@storable/core'

describe('Flush Microtask Tests', () => {
  it('should test if effects run after microtask flush', async () => {
    const [store, update] = createStore({ count: 0 })
    let effectRuns = 0
    let lastValue = null

    const cleanup = effect(() => {
      lastValue = store.count
      effectRuns++
      console.log(`Effect run #${effectRuns}, count = ${lastValue}`)
    })

    expect(effectRuns).toBe(1)
    expect(lastValue).toBe(0)

    // Update the store
    update({ $set: { count: 5 } })

    // Check immediately - effect probably hasn't run yet
    console.log('Immediately after update, effectRuns:', effectRuns)
    expect(effectRuns).toBe(1) // Still 1, effect hasn't run yet

    // Flush microtasks
    await Promise.resolve()

    // Now check again
    console.log('After microtask flush, effectRuns:', effectRuns)
    expect(effectRuns).toBe(2) // Should be 2 now
    expect(lastValue).toBe(5)
    expect(store.count).toBe(5)

    cleanup()
  })

  it('should test multiple updates with flush', async () => {
    const [store, update] = createStore({ value: 'initial' })
    let effectRuns = 0
    const values: string[] = []

    const cleanup = effect(() => {
      const val = store.value
      values.push(val)
      effectRuns++
      console.log(`Effect run #${effectRuns}, value = ${val}`)
    })

    expect(effectRuns).toBe(1)
    expect(values).toEqual(['initial'])

    // Multiple updates
    update({ $set: { value: 'first' } })
    update({ $set: { value: 'second' } })
    update({ $set: { value: 'third' } })

    // Before flush
    console.log('Before flush, effectRuns:', effectRuns)
    expect(effectRuns).toBe(1) // No effects run yet

    // Flush
    await Promise.resolve()

    // After flush - should only run once due to batching
    console.log('After flush, effectRuns:', effectRuns)
    console.log('Values collected:', values)
    expect(effectRuns).toBe(2) // Should run once for all batched updates
    expect(values[values.length - 1]).toBe('third')
    expect(store.value).toBe('third')

    cleanup()
  })

  it('should test setTimeout as alternative to Promise', done => {
    const [store, update] = createStore({ num: 10 })
    let effectRuns = 0

    const cleanup = effect(() => {
      const val = store.num
      effectRuns++
      console.log(`Effect run #${effectRuns}, num = ${val}`)
    })

    expect(effectRuns).toBe(1)

    update({ $set: { num: 20 } })
    expect(effectRuns).toBe(1) // Still 1

    setTimeout(() => {
      console.log('After setTimeout, effectRuns:', effectRuns)
      expect(effectRuns).toBe(2) // Should be 2 now
      expect(store.num).toBe(20)
      cleanup()
      done()
    }, 0)
  })

  it('should test queueMicrotask if available', async () => {
    if (typeof queueMicrotask !== 'function') {
      console.log('queueMicrotask not available, skipping test')
      return
    }

    const [store, update] = createStore({ flag: false })
    let effectRuns = 0

    const cleanup = effect(() => {
      const val = store.flag
      effectRuns++
      console.log(`Effect run #${effectRuns}, flag = ${val}`)
    })

    expect(effectRuns).toBe(1)

    update({ $set: { flag: true } })
    expect(effectRuns).toBe(1)

    await new Promise(resolve => queueMicrotask(resolve))

    console.log('After queueMicrotask, effectRuns:', effectRuns)
    expect(effectRuns).toBe(2)
    expect(store.flag).toBe(true)

    cleanup()
  })

  it('should test nested object updates with flush', async () => {
    const [store, update] = createStore({
      user: {
        name: 'Alice',
        settings: {
          theme: 'dark',
        },
      },
    })

    let effectRuns = 0
    let lastTheme = null

    const cleanup = effect(() => {
      lastTheme = store.user.settings.theme
      effectRuns++
      console.log(`Effect run #${effectRuns}, theme = ${lastTheme}`)
    })

    expect(effectRuns).toBe(1)
    expect(lastTheme).toBe('dark')

    // Update nested property
    update({ $set: { 'user.settings.theme': 'light' } })

    // Before flush
    expect(effectRuns).toBe(1)

    // After flush
    await Promise.resolve()

    expect(effectRuns).toBe(2)
    expect(lastTheme).toBe('light')
    expect(store.user.settings.theme).toBe('light')

    cleanup()
  })

  it('should test array operations with flush', async () => {
    const [store, update] = createStore({
      items: ['a', 'b', 'c'],
    })

    let effectRuns = 0
    let lastLength = 0

    const cleanup = effect(() => {
      lastLength = store.items.length
      effectRuns++
      console.log(`Effect run #${effectRuns}, length = ${lastLength}`)
    })

    expect(effectRuns).toBe(1)
    expect(lastLength).toBe(3)

    // Push item
    update({ $push: { items: 'd' } })

    // Before flush
    expect(effectRuns).toBe(1)
    expect(store.items.length).toBe(4) // Value is updated immediately

    // After flush
    await Promise.resolve()

    expect(effectRuns).toBe(2) // Effect should have run
    expect(lastLength).toBe(4)

    cleanup()
  })
})
