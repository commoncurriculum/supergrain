/**
 * Computed Values Tests
 *
 * Tests the exact computed values examples from the README.
 * Code is copied exactly from README with only setup and assertions added.
 */

import { describe, it, expect } from 'vitest'
import { createStore, computed } from '@storable/core'

describe('Computed Values Examples', () => {
  it('#DOC_TEST_20', () => {
    const [state, update] = createStore({
      todos: [
        { id: 1, text: 'Task 1', completed: false },
        { id: 2, text: 'Task 2', completed: true },
      ],
    })

    const completedCount = computed(
      () => state.todos.filter(t => t.completed).length
    )

    console.log(completedCount()) // 1
    expect(completedCount()).toBe(1)

    // Updates automatically when todos change
    update({
      $set: { 'todos.0.completed': true },
    })

    console.log(completedCount()) // 2
    expect(completedCount()).toBe(2)

    // Add another todo
    update({
      $push: {
        todos: { id: 3, text: 'Task 3', completed: false },
      },
    })

    // Should still be 2 completed
    expect(completedCount()).toBe(2)

    // Complete the new todo
    update({
      $set: { 'todos.2.completed': true },
    })

    // Now should be 3 completed
    expect(completedCount()).toBe(3)
  })
})
