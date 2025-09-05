import { describe, it, expect, vi } from 'vitest'
import { createStore, effect } from '../src'

describe('Array Operations with Operators', () => {
  it('should handle $push reactively', () => {
    const [state, update] = createStore<{ items: number[] }>({
      items: [1, 2],
    })
    let length = 0
    const effectFn = vi.fn(() => {
      length = state.items.length
    })

    effect(effectFn)
    expect(length).toBe(2)
    expect(effectFn).toHaveBeenCalledTimes(1)

    update({ $push: { items: 3 } })
    expect(length).toBe(3)
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle array replacement for splice-like behavior', () => {
    const [state, update] = createStore({ items: ['a', 'b', 'c', 'd'] })
    let first: string | undefined = ''
    let last: string | undefined = ''
    const effectFn = vi.fn(() => {
      first = state.items[0]
      last = state.items[state.items.length - 1]
    })

    effect(effectFn)
    expect(first).toBe('a')
    expect(last).toBe('d')
    expect(effectFn).toHaveBeenCalledTimes(1)

    update({ $set: { items: ['a', 'x', 'd'] } })

    expect(state.items).toEqual(['a', 'x', 'd'])
    expect(first).toBe('a')
    expect(last).toBe('d')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle array replacement for sort-like behavior', () => {
    const [state, update] = createStore({ items: [3, 1, 2] })
    let first: number | undefined = 0
    const effectFn = vi.fn(() => {
      first = state.items[0]
    })

    effect(effectFn)
    expect(first).toBe(3)
    expect(effectFn).toHaveBeenCalledTimes(1)

    const sorted = [...state.items].sort()
    update({ $set: { items: sorted } })

    expect(first).toBe(1)
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle array replacement for reverse-like behavior', () => {
    const [state, update] = createStore({ items: [1, 2, 3] })
    let first: number | undefined = 0
    const effectFn = vi.fn(() => {
      first = state.items[0]
    })

    effect(effectFn)
    expect(first).toBe(1)
    expect(effectFn).toHaveBeenCalledTimes(1)

    const reversed = [...state.items].reverse()
    update({ $set: { items: reversed } })

    expect(first).toBe(3)
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle $push efficiently', () => {
    const [state, update] = createStore<{ items: number[] }>({ items: [1] })
    let length = 0
    effect(() => {
      length = state.items.length
    })
    expect(length).toBe(1)
    update({ $push: { items: 2 } })
    expect(length).toBe(2)
  })

  it('should handle array replacement for splice', () => {
    const [state, update] = createStore({ items: [1, 2, 3] })
    let length = 0
    effect(() => {
      length = state.items.length
    })
    expect(length).toBe(3)
    update({ $set: { items: [1, 3] } })
    expect(length).toBe(2)
    expect(state.items).toEqual([1, 3])
  })

  it('should handle array replacement for sort', () => {
    const [state, update] = createStore({ items: [3, 1, 2] })
    let firstItem = 0
    effect(() => {
      if (state.items.length > 0) {
        firstItem = state.items[0]
      }
    })
    expect(firstItem).toBe(3)
    const sorted = [...state.items].sort()
    update({ $set: { items: sorted } })
    expect(firstItem).toBe(1)
  })
})
