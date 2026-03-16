import { describe, it, expect, vi } from 'vitest'
import { createStore, effect, unwrap } from '../../src'

describe('Store', () => {
  describe('createStore', () => {
    it('should create a store with initial state', () => {
      const [state] = createStore({ count: 0, name: 'test' })
      expect(state.count).toBe(0)
      expect(state.name).toBe('test')
    })

    it('should update state with the update function', () => {
      const [state, update] = createStore({ count: 0 })
      update({ $set: { count: 5 } })
      expect(state.count).toBe(5)
      update({ $inc: { count: 1 } })
      expect(state.count).toBe(6)
    })

    it('should handle nested objects reactively', () => {
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

    it('should handle array updates reactively', () => {
      const [state, update] = createStore<any>({ items: [1, 2, 3] })
      let sum = 0
      const effectFn = vi.fn(() => {
        sum = 0
        for (const item of state.items) {
          sum += item
        }
      })

      effect(effectFn)
      expect(sum).toBe(6)
      expect(effectFn).toHaveBeenCalledTimes(1)

      update({ $set: { 'items.1': 5 } })
      expect(state.items).toEqual([1, 5, 3])
      expect(sum).toBe(9)
      expect(effectFn).toHaveBeenCalledTimes(2)

      update({ $set: { items: [10, 20] } })
      expect(sum).toBe(30)
      expect(effectFn).toHaveBeenCalledTimes(3)
    })

    it('should batch multiple operators in one update call', () => {
      const [state, update] = createStore<any>({ a: 1, b: 2 })
      let sum = 0
      const effectFn = vi.fn(() => {
        sum = state.a + state.b
      })

      effect(effectFn)
      expect(sum).toBe(3)
      expect(effectFn).toHaveBeenCalledTimes(1)

      update({
        $set: { a: 10 },
        $inc: { b: 18 },
      })

      expect(sum).toBe(30)
      expect(effectFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Edge Cases', () => {
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

      let selfValue = 0
      effect(() => {
        selfValue = state.self.value
      })

      expect(state.value).toBe(1)
      expect(selfValue).toBe(1)
      expect(unwrap(state.self)).toBe(obj)
    })

    it('should handle null and undefined values reactively', () => {
      const [state, update] = createStore<{
        nullable: string | null
        undef: string | undefined
      }>({
        nullable: null,
        undef: undefined,
      })

      let nullValue: string | null = null
      let undefValue: string | undefined = undefined
      effect(() => {
        nullValue = state.nullable
        undefValue = state.undef
      })

      expect(nullValue).toBe(null)
      expect(undefValue).toBe(undefined)

      update({ $set: { nullable: 'value' } })
      expect(nullValue).toBe('value')

      update({ $set: { undef: 'value' } })
      expect(undefValue).toBe('value')
    })

    it('should handle nested reactivity in arrays', () => {
      const [state, update] = createStore<any>({
        users: [
          { name: 'Alice', tasks: ['task1'] },
          { name: 'Bob', tasks: ['task3'] },
        ],
      })

      let bobTasks: string[] = []
      effect(() => {
        bobTasks = state.users[1]?.tasks || []
      })

      expect(bobTasks).toEqual(['task3'])
      update({ $push: { 'users.1.tasks': 'task4' } })
      expect(bobTasks).toEqual(['task3', 'task4'])
    })

    it('should handle adding new properties reactively', () => {
      const [state, update] = createStore<any>({ initial: true })
      let keys: string[] = []
      effect(() => {
        keys = Object.keys(state)
      })

      expect(keys).toEqual(['initial'])
      update({ $set: { newProp: 'value' } })
      expect(state.newProp).toBe('value')
      expect(keys.sort()).toEqual(['initial', 'newProp'])
    })

    it('should allow deletion of properties with $unset', () => {
      const [state, update] = createStore<any>({ a: 1, b: 2 })
      let keys: string[] = []
      effect(() => {
        keys = Object.keys(state)
      })
      expect(keys.sort()).toEqual(['a', 'b'])

      update({ $unset: { b: 1 } })
      expect(keys.sort()).toEqual(['a'])
      expect(state.b).toBeUndefined()
    })
  })
})
