import { beforeEach, afterEach, vi } from 'vitest'

// Mock console methods to reduce test noise
const originalConsole = { ...console }

beforeEach(() => {
  // Reset all mocks before each test
  vi.clearAllMocks()

  // Mock console methods for cleaner test output
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // Restore console methods
  console.warn = originalConsole.warn
  console.error = originalConsole.error

  // Clean up any remaining timers
  vi.clearAllTimers()
  vi.useRealTimers()
})

// Add custom matchers or global test utilities here
declare global {
  namespace Vi {
    interface JestAssertion<T = any> {
      // Add custom matchers here if needed
    }
  }
}
