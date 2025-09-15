/**
 * Effects Tests
 *
 * Tests the exact effects examples from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStore, effect } from '@storable/core'

describe('Effects Examples', () => {
  let localStorageMock: any

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })

    // Mock console.log
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('#DOC_TEST_19', () => {
    const [state, update] = createStore({ count: 0 })

    const logSpy = vi.spyOn(console, 'log')

    // This runs whenever count changes
    effect(() => {
      console.log('Count changed to:', state.count)
    })

    // Save to localStorage on change
    effect(() => {
      localStorage.setItem('count', String(state.count))
    })

    // Initial effect should run
    expect(logSpy).toHaveBeenCalledWith('Count changed to:', 0)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('count', '0')

    // Update count and verify effects run
    update({ $set: { count: 5 } })

    expect(logSpy).toHaveBeenCalledWith('Count changed to:', 5)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('count', '5')

    // Update again
    update({ $inc: { count: 1 } })

    expect(logSpy).toHaveBeenCalledWith('Count changed to:', 6)
    expect(localStorageMock.setItem).toHaveBeenCalledWith('count', '6')
  })
})
