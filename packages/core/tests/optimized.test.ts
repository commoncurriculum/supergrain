import { describe, it, expect, vi } from 'vitest'
import { createStore, effect, unwrap } from '../src'

describe('Optimized Store', () => {
  describe('createStore', () => {
    it('should create a reactive store with initial state', () => {
      const [state] = createStore({ count: 0 })
      expect(state.count).toBe(0)
    })

    it('should update state using the update function', () => {
      const [state, update] = createStore({ count: 0 })
      update({ $set: { count: 5 } })
      expect(state.count).toBe(5)
    })

    it('should handle nested objects', () => {
      const [state, update] = createStore({
        user: { address: { city: 'New York' } },
      })
      let city = ''
      const effectFn = vi.fn(() => {
        city = state.user.address.city
      })

      effect(effectFn)
      expect(city).toBe('New York')
      expect(effectFn).toHaveBeenCalledTimes(1)

      update({ $set: { 'user.address.city': 'Boston' } })
      expect(city).toBe('Boston')
      expect(effectFn).toHaveBeenCalledTimes(2)
    })

    it('should batch multiple operators in a single call', () => {
      const [state, update] = createStore<any>({ a: 1, b: 2, c: 3 })
      let sum = 0
      const effectFn = vi.fn(() => {
        sum = state.a + state.b + (state.c || 0)
      })

      effect(effectFn)
      expect(sum).toBe(6)
      expect(effectFn).toHaveBeenCalledTimes(1)

      update({
        $set: { a: 10 },
        $inc: { b: 8 },
        $unset: { c: 1 },
      })

      expect(state.a).toBe(10)
      expect(state.b).toBe(10)
      expect(state.c).toBeUndefined()
      expect(sum).toBe(20)
      expect(effectFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Performance optimizations', () => {
    it('should not create signals for untracked properties', () => {
      const [state] = createStore<any>({ a: { b: 1 } })
      const rawA = unwrap(state.a)
      expect((rawA as any).$NODE).toBeUndefined()

      let b = 0
      effect(() => {
        b = state.a.b
      })
      expect(b).toBe(1)

      expect((state.a as any).$NODE).toBeDefined()
    })

    it('should cache proxy references', () => {
      const data = { nested: {} }
      const [state] = createStore(data)
      const nested1 = state.nested
      const nested2 = state.nested
      expect(nested1).toBe(nested2)
    })

    it('should handle Object.keys reactively', () => {
      const [state, update] = createStore<any>({ a: 1, b: 2 })
      let keys: string[] = []
      effect(() => {
        keys = Object.keys(state)
      })
      expect(keys.sort()).toEqual(['a', 'b'])
      update({ $set: { c: 3 } })
      expect(keys.sort()).toEqual(['a', 'b', 'c'])
    })

    it('should handle delete operations with $unset', () => {
      const [state, update] = createStore<any>({ a: 1, b: 2 })
      let keys: string[] = []
      effect(() => {
        keys = Object.keys(state)
      })
      expect(keys.sort()).toEqual(['a', 'b'])
      update({ $unset: { b: 1 } })
      expect(keys.sort()).toEqual(['a'])
    })
  })

  describe('Edge cases', () => {
    it('should handle frozen objects gracefully', () => {
      const frozen = Object.freeze({ value: 1 })
      const [state] = createStore({ frozen })
      let value = 0
      effect(() => {
        value = state.frozen.value
      })
      expect(value).toBe(1)
    })

    it('should handle circular references', () => {
      const obj: any = { value: 1 }
      obj.self = obj
      const [state] = createStore(obj)
      let val = 0
      effect(() => {
        val = state.self.value
      })
      expect(val).toBe(1)
    })

    it('should handle null and undefined values', () => {
      const [state, update] = createStore<any>({ a: null })
      let a: any = null
      effect(() => {
        a = state.a
      })
      expect(a).toBe(null)
      update({ $set: { a: 'value' } })
      expect(a).toBe('value')
    })
  })
})
