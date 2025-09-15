/**
 * Reading State Tests
 *
 * Tests the exact reading state examples from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'

describe('Reading State Example', () => {
  it('#DOC_TEST_4', () => {
    const [state, update] = createStore({ count: 0, name: 'John' })

    // You can read properties normally
    console.log(state.count) // 0
    console.log(state.name) // 'John'

    expect(state.count).toBe(0)
    expect(state.name).toBe('John')

    // Direct mutations are supported
    state.count = 5 // ✅ Works fine!
    state.name = 'Jane' // ✅ Works fine!

    expect(state.count).toBe(5)
    expect(state.name).toBe('Jane')

    // Update function also works
    update({ $set: { count: 10, name: 'Bob' } })

    expect(state.count).toBe(10)
    expect(state.name).toBe('Bob')
  })
})
