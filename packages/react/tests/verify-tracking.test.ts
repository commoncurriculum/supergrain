import { describe, it, expect, vi } from 'vitest'
import {
  createStore,
  effect,
  getCurrentSub,
  setCurrentSub,
} from '@storable/core'

describe('Verify Tracking Mechanism', () => {
  it('should verify basic effect tracking works with store', () => {
    const [store, update] = createStore({ count: 0 })
    let effectRuns = 0

    // Create an effect that accesses store.count
    const cleanup = effect(() => {
      const value = store.count
      effectRuns++
      console.log(`Effect run #${effectRuns}, count = ${value}`)
    })

    // Effect should run immediately
    expect(effectRuns).toBe(1)

    // Update should trigger the effect
    update({ $set: { count: 5 } })
    expect(effectRuns).toBe(2)

    cleanup()
  })

  it('should verify getCurrentSub/setCurrentSub work', () => {
    // Check initial state
    const initialSub = getCurrentSub()
    console.log('Initial subscriber:', initialSub)

    // Create a dummy effect to get a subscriber node
    let effectNode: any = null
    const cleanup = effect(() => {
      effectNode = getCurrentSub()
      console.log('Inside effect, getCurrentSub:', effectNode)
    })

    console.log('After effect, getCurrentSub:', getCurrentSub())
    console.log('Effect node captured:', effectNode)

    // Try manually setting the subscriber
    const prevSub = setCurrentSub(effectNode)
    console.log('After setCurrentSub, getCurrentSub:', getCurrentSub())
    console.log('Previous subscriber was:', prevSub)

    // Restore
    setCurrentSub(prevSub)
    console.log('After restore, getCurrentSub:', getCurrentSub())

    cleanup()
  })

  it('should verify store tracks access when subscriber is active', () => {
    const [store, update] = createStore({ value: 'test' })
    let trackingWorked = false

    // Create an effect but don't access store yet
    const cleanup = effect(() => {
      console.log('Effect callback running')
      trackingWorked = true
    })

    // The effect ran once immediately
    expect(trackingWorked).toBe(true)
    trackingWorked = false

    // Now update the store - effect shouldn't run because it didn't track store.value
    update({ $set: { value: 'changed' } })
    expect(trackingWorked).toBe(false) // Should still be false

    // Now create an effect that DOES access the store
    const cleanup2 = effect(() => {
      const val = store.value // Access the store
      console.log('Effect2 with value:', val)
      trackingWorked = true
    })

    trackingWorked = false
    update({ $set: { value: 'changed again' } })
    expect(trackingWorked).toBe(true) // Should be true now

    cleanup()
    cleanup2()
  })

  it('should test manual subscriber setting during store access', () => {
    const [store, update] = createStore({ num: 100 })
    let manualEffectRuns = 0

    // Create an effect to get a subscriber node, but don't access store yet
    let effectNode: any = null
    const cleanup = effect(() => {
      effectNode = getCurrentSub()
      manualEffectRuns++
      console.log(`Manual effect run #${manualEffectRuns}`)
    })

    // Reset counter after initial run
    manualEffectRuns = 0

    // Manually set this as current subscriber and access store
    const prevSub = setCurrentSub(effectNode)
    const value = store.num // This access should now be tracked
    console.log('Accessed store.num:', value)
    setCurrentSub(prevSub)

    // Now update - the effect should run
    update({ $set: { num: 200 } })
    expect(manualEffectRuns).toBe(1) // Should have run once from the update

    cleanup()
  })
})
