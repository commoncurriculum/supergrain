import { describe, it, expect } from 'vitest'
import {
  createStore,
  effect,
  signal,
  getCurrentSub,
  setCurrentSub,
} from '@storable/core'
import { flushMicrotasks } from './test-utils'

describe('Manual Dependency Linking', () => {
  it('should test if we can manually track dependencies', async () => {
    const [store, update] = createStore({ value: 1 })
    let effectRuns = 0
    let trackedValue = 0

    // Create an effect but don't access the store yet
    let effectNode: any = null
    const cleanup = effect(() => {
      effectRuns++
      effectNode = getCurrentSub()
      console.log(`Effect run #${effectRuns}, node:`, effectNode)
    })

    expect(effectRuns).toBe(1)
    console.log('Effect node after creation:', effectNode)
    console.log('Effect node deps:', effectNode?.deps)
    console.log('Effect node subs:', effectNode?.subs)

    // Now manually set the effect as current subscriber and access the store
    const prevSub = setCurrentSub(effectNode)
    trackedValue = store.value // This should establish a dependency
    setCurrentSub(prevSub)

    console.log('After manual access, effect node deps:', effectNode?.deps)

    // Update the store and see if the effect runs
    update({ $set: { value: 2 } })
    await flushMicrotasks()

    console.log('After update, effectRuns:', effectRuns)
    expect(effectRuns).toBe(2) // Should have run again if dependency was established

    cleanup()
  })

  it('should test accessing signal node directly', async () => {
    // Create a raw signal to understand the node structure
    const sig = signal(10)
    let effectRuns = 0

    // Create an effect that accesses the signal
    const cleanup = effect(() => {
      effectRuns++
      const value = sig()
      console.log(`Effect run #${effectRuns}, signal value: ${value}`)
    })

    expect(effectRuns).toBe(1)

    // Check the signal's internal structure
    console.log('Signal function:', sig)
    console.log('Signal properties:', Object.keys(sig))
    console.log('Signal descriptors:', Object.getOwnPropertyDescriptors(sig))

    // Try to access the signal's reactive node
    const sigNode = (sig as any).node || (sig as any)._node || sig
    console.log('Signal node:', sigNode)

    // Update the signal
    sig(20)
    await flushMicrotasks()

    expect(effectRuns).toBe(2)
    cleanup()
  })

  it('should test if store properties expose signal nodes', async () => {
    const [store, update] = createStore({ count: 5 })

    // Try to access the internal structure of the store
    console.log('Store:', store)
    console.log('Store keys:', Object.keys(store))
    console.log('Store symbols:', Object.getOwnPropertySymbols(store))

    // Check if we can access the signal node for a property
    const storeAny = store as any
    console.log('Store.$NODE:', storeAny[Symbol.for('store-node')])
    console.log('Store.$PROXY:', storeAny[Symbol.for('store-proxy')])

    // Try to get the underlying signal for a property
    let effectRuns = 0
    let nodeAccessed = false

    const cleanup = effect(() => {
      effectRuns++
      const sub = getCurrentSub()
      console.log(`Effect run #${effectRuns}, current sub:`, sub)

      // Try to access the store property while tracking is active
      const value = store.count
      console.log(`Accessed store.count = ${value}`)

      // Check if a dependency was created
      if (sub && (sub as any).deps) {
        console.log('Effect has deps after access:', (sub as any).deps)
        nodeAccessed = true
      }
    })

    expect(effectRuns).toBe(1)
    expect(nodeAccessed).toBe(true)

    // Update and verify the effect runs again
    update({ $set: { count: 10 } })
    await flushMicrotasks()

    expect(effectRuns).toBe(2)
    cleanup()
  })

  it('should experiment with creating a trackable wrapper', async () => {
    const [store, update] = createStore({ x: 1, y: 2 })
    let effectRuns = 0
    let effectNode: any = null
    let accessedProperties: string[] = []

    // Create an effect that will be manually triggered
    const cleanup = effect(() => {
      effectRuns++
      effectNode = getCurrentSub()
      console.log(`Wrapper effect run #${effectRuns}`)

      // On subsequent runs, re-access the tracked properties
      if (effectRuns > 1 && accessedProperties.length > 0) {
        const prevSub = setCurrentSub(effectNode)
        for (const prop of accessedProperties) {
          const value = (store as any)[prop]
          console.log(`Re-accessing ${prop} = ${value}`)
        }
        setCurrentSub(prevSub)
      }
    })

    expect(effectRuns).toBe(1)

    // Simulate component render: track what properties are accessed
    const prevSub = setCurrentSub(effectNode)

    // Access some properties
    const xValue = store.x
    accessedProperties.push('x')
    console.log(`Component accessed x = ${xValue}`)

    const yValue = store.y
    accessedProperties.push('y')
    console.log(`Component accessed y = ${yValue}`)

    setCurrentSub(prevSub)

    console.log('Tracked properties:', accessedProperties)
    console.log('Effect node deps after access:', effectNode?.deps)

    // Update one of the tracked properties
    update({ $set: { x: 10 } })
    await flushMicrotasks()

    console.log('After update, effectRuns:', effectRuns)

    // The effect should have run if dependencies were established
    expect(effectRuns).toBe(2)

    cleanup()
  })

  it('should test if we can force re-run of effect', async () => {
    const [store, update] = createStore({ value: 100 })
    let effectRuns = 0
    let manualTrigger: (() => void) | null = null

    // Create a signal that we control
    const trigger = signal(0)

    // Create an effect that depends on both the trigger and accesses the store
    const cleanup = effect(() => {
      effectRuns++
      trigger() // Create a dependency on our trigger

      // Now access the store
      const value = store.value
      console.log(`Effect run #${effectRuns}, store value: ${value}`)
    })

    expect(effectRuns).toBe(1)

    // Update the store
    update({ $set: { value: 200 } })
    await flushMicrotasks()

    // The effect should run because store.value changed
    expect(effectRuns).toBe(2)

    // Update the store again
    update({ $set: { value: 300 } })
    await flushMicrotasks()

    expect(effectRuns).toBe(3)

    // We can also manually trigger by updating our trigger signal
    trigger(1)
    await flushMicrotasks()

    expect(effectRuns).toBe(4)

    cleanup()
  })
})
