import { describe, it, expect, vi } from 'vitest'
import { createStore, effect, unwrap } from '../src'
import { startBatch, endBatch } from 'alien-signals'

describe('Store', () => {
  describe('createStore', () => {
    it('should create a store with initial state', () => {
      const [state] = createStore({ count: 0, name: 'test' })
      expect(state.count).toBe(0)
      expect(state.name).toBe('test')
    })

    it('should update state with the setter function', () => {
      const [state, setState] = createStore({ count: 0 })
      setState('count', 5)
      expect(state.count).toBe(5)
      setState('count', (c: number) => c + 1)
      expect(state.count).toBe(6)
    })

    it('should handle nested objects reactively', () => {
      const [state, setState] = createStore({
        user: { address: { city: 'New York' } },
      })
      let city = ''
      const effectFn = vi.fn(() => {
        city = state.user.address.city
      })

      effect(effectFn)
      expect(city).toBe('New York')
      expect(effectFn).toHaveBeenCalledTimes(1)

      setState('user', 'address', 'city', 'Boston')
      expect(city).toBe('Boston')
      expect(effectFn).toHaveBeenCalledTimes(2)
    })

    it('should handle array updates reactively', () => {
      const [state, setState] = createStore({ items: [1, 2, 3] })
      let sum = 0
      const effectFn = vi.fn(() => {
        sum = state.items.reduce((a, b) => a + b, 0)
      })

      effect(effectFn)
      expect(sum).toBe(6)
      expect(effectFn).toHaveBeenCalledTimes(1)

      setState('items', 1, 5) // Update state.items[1] to 5
      expect(state.items).toEqual([1, 5, 3])
      expect(sum).toBe(9)
      expect(effectFn).toHaveBeenCalledTimes(2)

      setState({ items: [10, 20] }) // Replace the whole array
      expect(sum).toBe(30)
      expect(effectFn).toHaveBeenCalledTimes(3)
    })

    it('should batch multiple updates', () => {
      const [state, setState] = createStore({ a: 1, b: 2 })
      let sum = 0
      const effectFn = vi.fn(() => {
        sum = state.a + state.b
      })

      effect(effectFn)
      expect(sum).toBe(3)
      expect(effectFn).toHaveBeenCalledTimes(1)

      startBatch()
      setState('a', 10)
      setState('b', 20)
      endBatch()

      expect(sum).toBe(30)
      expect(effectFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('Array Operations', () => {
    it('should handle push reactively', () => {
      const [state] = createStore({ items: [1, 2] })
      let length = 0
      const effectFn = vi.fn(() => {
        length = state.items.length
      })

      effect(effectFn)
      expect(length).toBe(2)
      expect(effectFn).toHaveBeenCalledTimes(1)

      state.items.push(3)
      expect(length).toBe(3)
      expect(effectFn).toHaveBeenCalledTimes(2)
    })

    it('should handle splice reactively', () => {
      const [state] = createStore({ items: ['a', 'b', 'c', 'd'] })
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

      state.items.splice(1, 2, 'x') // remove 'b', 'c', insert 'x'
      expect(state.items).toEqual(['a', 'x', 'd'])
      expect(first).toBe('a')
      expect(last).toBe('d')
      expect(effectFn.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle sort reactively', () => {
      const [state] = createStore({ items: [3, 1, 2] })
      let first: number | undefined = 0
      const effectFn = vi.fn(() => {
        first = state.items[0]
      })

      effect(effectFn)
      expect(first).toBe(3)
      expect(effectFn).toHaveBeenCalledTimes(1)

      state.items.sort()
      expect(first).toBe(1)
      expect(effectFn).toHaveBeenCalledTimes(2)
    })

    it('should handle reverse reactively', () => {
      const [state] = createStore({ items: [1, 2, 3] })
      let first: number | undefined = 0
      const effectFn = vi.fn(() => {
        first = state.items[0]
      })

      effect(effectFn)
      expect(first).toBe(1)
      expect(effectFn).toHaveBeenCalledTimes(1)

      state.items.reverse()
      expect(first).toBe(3)
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
      expect(state.value).toBe(1)
      expect(state.self.value).toBe(1)
      expect(unwrap(state.self)).toBe(obj)
    })

    it('should handle null and undefined values reactively', () => {
      const [state, setState] = createStore<{
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

      setState('nullable', 'value')
      expect(nullValue).toBe('value')

      setState('undef', 'value')
      expect(undefValue).toBe('value')
    })

    it('should handle nested reactivity in arrays', () => {
      const [state] = createStore({
        users: [
          { name: 'Alice', tasks: ['task1'] },
          { name: 'Bob', tasks: ['task3'] },
        ],
      })

      let bobTasks: string[] = []
      effect(() => {
        const user = state.users[1]
        if (user) {
          bobTasks = user.tasks
        }
      })

      expect(bobTasks).toEqual(['task3'])
      const user = state.users[1]
      if (user) {
        user.tasks.push('task4')
      }
      expect(bobTasks).toEqual(['task3', 'task4'])
    })

    it('should handle adding new properties reactively', () => {
      const [state, setState] = createStore<any>({ initial: true })
      let keys: string[] = []
      effect(() => {
        keys = Object.keys(state)
      })

      expect(keys).toEqual(['initial'])
      setState('newProp', 'value')
      expect(state.newProp).toBe('value')
      expect(keys).toEqual(['initial', 'newProp'])
    })

    it('should allow deletion of properties', () => {
      const [state] = createStore<any>({ a: 1, b: 2 })
      let keys: string[] = []
      effect(() => {
        keys = Object.keys(state)
      })
      expect(keys).toEqual(['a', 'b'])

      delete state.b
      expect(keys).toEqual(['a'])
      expect(state.b).toBeUndefined()
    })
  })
})
