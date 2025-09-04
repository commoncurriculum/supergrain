// Simple test to verify testing setup is working
import { describe, it, expect } from 'vitest'

describe('Setup Test', () => {
  it('should verify that the testing environment is working', () => {
    expect(true).toBe(true)
  })

  it('should handle basic arithmetic', () => {
    expect(2 + 2).toBe(4)
  })

  it('should handle string operations', () => {
    const greeting = 'Hello, World!'
    expect(greeting).toContain('World')
    expect(greeting.length).toBe(13)
  })
})
