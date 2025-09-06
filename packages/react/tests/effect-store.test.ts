import { describe, it, expect, vi } from 'vitest'
import { signal } from '@storable/core'
import { EffectStore } from '../src/effect-store'

describe('EffectStore', () => {
  it('should track version changes', () => {
    const store = new EffectStore()

    // Initial version should be 0
    expect(store.getSnapshot()).toBe(0)
    expect(store.getServerSnapshot()).toBe(0)
  })

  it('should manage subscriptions', () => {
    const store = new EffectStore()
    const listener = vi.fn()

    // Subscribe
    const unsubscribe = store.subscribe(listener)

    // Listener should not be called immediately
    expect(listener).not.toHaveBeenCalled()

    // Unsubscribe should work
    unsubscribe()

    // After unsubscribe, store should not have the listener
    // (we can't directly test this without exposing internals)
  })

  it('should track dependencies via tracked function', () => {
    const store = new EffectStore()
    const listener = vi.fn()
    const sig = signal(0)

    store.subscribe(listener)

    // Set a tracked function that accesses the signal
    const trackedFn = vi.fn(() => {
      // Access the signal value to establish dependency
      sig.value
    })

    store.setTrackedFunction(trackedFn)

    // The tracked function should be called immediately
    expect(trackedFn).toHaveBeenCalledTimes(1)

    // Changing the signal should trigger the listener
    sig.value = 1

    // The listener should be notified of the change
    expect(listener).toHaveBeenCalled()
  })

  it('should clean up on dispose', () => {
    const store = new EffectStore()
    const listener = vi.fn()
    const sig = signal(0)

    store.subscribe(listener)

    const trackedFn = () => {
      sig.value
    }
    store.setTrackedFunction(trackedFn)

    // Dispose should clean everything up
    store.dispose()

    // After dispose, changing the signal should not trigger listener
    sig.value = 1
    expect(listener).not.toHaveBeenCalled()
  })

  it('should maintain 32-bit integer for version', () => {
    const store = new EffectStore()

    // Version should always be a 32-bit integer
    const version = store.getSnapshot()
    expect(Number.isInteger(version)).toBe(true)
    expect(version).toBe(version | 0) // Should equal itself when coerced to 32-bit
  })

  it('should replace tracked function when called multiple times', () => {
    const store = new EffectStore()
    const sig1 = signal(0)
    const sig2 = signal(0)
    const listener = vi.fn()

    store.subscribe(listener)

    // Set first tracked function
    const trackedFn1 = vi.fn(() => {
      sig1.value
    })
    store.setTrackedFunction(trackedFn1)

    expect(trackedFn1).toHaveBeenCalledTimes(1)

    // Set second tracked function (should replace the first)
    const trackedFn2 = vi.fn(() => {
      sig2.value
    })
    store.setTrackedFunction(trackedFn2)

    expect(trackedFn2).toHaveBeenCalledTimes(1)

    // Changing sig1 should NOT trigger listener (no longer tracked)
    sig1.value = 1
    expect(listener).not.toHaveBeenCalled()

    // Changing sig2 SHOULD trigger listener
    sig2.value = 1
    expect(listener).toHaveBeenCalled()
  })
})
