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

  it('should track when startTracking/endTracking are called', () => {
    const store = new EffectStore()

    expect(store.isTracking).toBe(false)

    store.startTracking()
    expect(store.isTracking).toBe(true)

    store.endTracking()
    expect(store.isTracking).toBe(false)
  })

  it('should warn when tracking methods are called incorrectly', () => {
    const store = new EffectStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Calling endTracking without startTracking
    store.endTracking()
    expect(warnSpy).toHaveBeenCalledWith(
      'EffectStore: endTracking called while not tracking'
    )

    // Calling startTracking twice
    store.startTracking()
    store.startTracking()
    expect(warnSpy).toHaveBeenCalledWith(
      'EffectStore: startTracking called while already tracking'
    )

    warnSpy.mockRestore()
  })

  it('should clean up on dispose', () => {
    const store = new EffectStore()
    const listener = vi.fn()

    store.subscribe(listener)
    store.startTracking()

    // Dispose should clean everything up
    store.dispose()

    // After dispose, tracking should be false
    expect(store.isTracking).toBe(false)
  })

  it('should maintain 32-bit integer for version', () => {
    const store = new EffectStore()

    // Version should always be a 32-bit integer
    const version = store.getSnapshot()
    expect(Number.isInteger(version)).toBe(true)
    expect(version).toBe(version | 0) // Should equal itself when coerced to 32-bit
  })
})
