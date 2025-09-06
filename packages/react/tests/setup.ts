// Test setup for browser-based tests
import '@testing-library/react'

// Add custom matchers if needed
declare global {
  interface Window {
    __TEST_MODE__: boolean
  }
}

// Mark as test mode
if (typeof window !== 'undefined') {
  window.__TEST_MODE__ = true
}

// Polyfill for requestIdleCallback if not available
if (typeof window !== 'undefined' && !window.requestIdleCallback) {
  window.requestIdleCallback = (cb: IdleRequestCallback) => {
    const start = Date.now()
    return setTimeout(() => {
      cb({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start)),
      } as IdleDeadline)
    }, 1) as unknown as number
  }

  window.cancelIdleCallback = (id: number) => {
    clearTimeout(id)
  }
}
