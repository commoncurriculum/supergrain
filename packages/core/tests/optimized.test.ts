import { describe, it, expect, vi } from 'vitest'
import { createStore, ReactiveStore } from '../src/store-optimized'
import { effect, signal, startBatch, endBatch } from 'alien-signals'

describe('Optimized Store', () => {
  describe('createStore', () => {
    it('should create a reactive store with initial state', () => {
      const [store, setStore] = createStore({
        user: { name: 'John', age: 30 },
        items: [1, 2, 3],
      })

      expect(store.user.name).toBe('John')
      expect(store.user.age).toBe(30)
      expect(store.items).toEqual([1, 2, 3])
    })

    it('should track property access in effects', () => {
      const [store, setStore] = createStore({
        user: { name: 'John', age: 30 },
      })

      let effectCount = 0
      let lastName = ''

      effect(() => {
        lastName = store.user.name
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(lastName).toBe('John')

      setStore('user', 'name', 'Jane')
      expect(effectCount).toBe(2)
      expect(lastName).toBe('Jane')
    })

    it('should handle nested property updates', () => {
      const [store, setStore] = createStore({
        user: {
          profile: {
            email: 'john@example.com',
            settings: {
              theme: 'dark',
            },
          },
        },
      })

      let effectCount = 0
      let theme = ''

      effect(() => {
        theme = store.user.profile.settings.theme
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(theme).toBe('dark')

      setStore('user', 'profile', 'settings', 'theme', 'light')
      expect(effectCount).toBe(2)
      expect(theme).toBe('light')
    })

    it('should support updater functions', () => {
      const [store, setStore] = createStore({
        counter: 0,
        items: [1, 2, 3],
      })

      setStore('counter', (c: number) => c + 1)
      expect(store.counter).toBe(1)

      setStore('items', (items: number[]) => [...items, 4])
      expect(store.items).toEqual([1, 2, 3, 4])
    })
  })

  describe('Array operations', () => {
    it('should handle array push/pop operations', () => {
      const [store, setStore] = createStore({
        items: [1, 2, 3],
      })

      let effectCount = 0
      let length = 0

      effect(() => {
        length = store.items.length
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(length).toBe(3)

      store.items.push(4)
      expect(effectCount).toBe(2)
      expect(length).toBe(4)
      expect(store.items).toEqual([1, 2, 3, 4])

      store.items.pop()
      expect(effectCount).toBe(3)
      expect(length).toBe(3)
      expect(store.items).toEqual([1, 2, 3])
    })

    it('should handle array splice operations', () => {
      const [store] = createStore({
        items: [1, 2, 3, 4, 5],
      })

      let effectCount = 0
      let secondItem = 0

      effect(() => {
        secondItem = store.items[1]
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(secondItem).toBe(2)

      store.items.splice(1, 2, 10, 20)
      expect(effectCount).toBe(2)
      expect(secondItem).toBe(10)
      expect(store.items).toEqual([1, 10, 20, 4, 5])
    })

    it('should batch array mutations', () => {
      const [store] = createStore({
        items: [] as number[],
      })

      let effectCount = 0

      effect(() => {
        const _ = store.items.length
        effectCount++
      })

      expect(effectCount).toBe(1)

      startBatch()
      store.items.push(1)
      store.items.push(2)
      store.items.push(3)
      endBatch()

      // Should only trigger once due to batching
      expect(effectCount).toBe(2)
      expect(store.items).toEqual([1, 2, 3])
    })

    it('should handle direct array index assignment', () => {
      const [store, setStore] = createStore({
        items: [1, 2, 3],
      })

      let effectCount = 0
      let value = 0

      effect(() => {
        value = store.items[1]
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(value).toBe(2)

      setStore('items', 1, 20)
      expect(effectCount).toBe(2)
      expect(value).toBe(20)
      expect(store.items).toEqual([1, 20, 3])
    })
  })

  describe('Object operations', () => {
    it('should track Object.keys() changes', () => {
      const [store, setStore] = createStore({
        data: { a: 1, b: 2 } as Record<string, number>,
      })

      let effectCount = 0
      let keys: string[] = []

      effect(() => {
        keys = Object.keys(store.data)
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(keys).toEqual(['a', 'b'])

      setStore('data', 'c', 3)
      expect(effectCount).toBe(2)
      expect(keys).toEqual(['a', 'b', 'c'])

      setStore('data', 'a', undefined as any)
      delete store.data.a
      expect(effectCount).toBe(3)
      expect(keys).toEqual(['b', 'c'])
    })

    it('should handle property deletion', () => {
      const [store, setStore] = createStore({
        data: { a: 1, b: 2, c: 3 } as Record<string, number>,
      })

      let effectCount = 0
      let hasB = false

      effect(() => {
        hasB = 'b' in store.data
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(hasB).toBe(true)

      delete store.data.b
      expect(effectCount).toBe(2)
      expect(hasB).toBe(false)
      expect(store.data).toEqual({ a: 1, c: 3 })
    })
  })

  describe('Performance optimizations', () => {
    it('should not create signals for non-reactive reads', () => {
      const [store] = createStore({
        user: { name: 'John', age: 30 },
      })

      // Access properties outside of effect - should not create signals
      const name1 = store.user.name
      const age1 = store.user.age

      // Check that no signals were created (internal check)
      const nodes = (store.user as any)[Symbol.for('store-node')]
      expect(nodes).toBeUndefined()
    })

    it('should create signals only on first reactive access', () => {
      const [store] = createStore({
        user: { name: 'John', age: 30 },
      })

      let name = ''

      // First reactive access - should create signal
      effect(() => {
        name = store.user.name
      })

      // Check that signal was created
      const nodes = (store.user as any)[Symbol.for('store-node')]
      expect(nodes).toBeDefined()
      expect(nodes.name).toBeDefined()
      expect(typeof nodes.name).toBe('function')
    })

    it('should cache proxies on the object itself', () => {
      const obj = { value: 1 }
      const [store] = createStore({ data: obj })

      // Access the same object multiple times
      const proxy1 = store.data
      const proxy2 = store.data

      // Should return the same proxy instance
      expect(proxy1).toBe(proxy2)

      // Check that proxy is cached on the object
      const cachedProxy = (obj as any)[Symbol.for('store-proxy')]
      expect(cachedProxy).toBe(proxy1)
    })

    it('should batch multiple mutations in a single effect cycle', () => {
      const [store, setStore] = createStore({
        a: 1,
        b: 2,
        c: 3,
      })

      let effectCount = 0
      let sum = 0

      effect(() => {
        sum = store.a + store.b + store.c
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(sum).toBe(6)

      // Multiple updates should be batched
      startBatch()
      setStore('a', 10)
      setStore('b', 20)
      setStore('c', 30)
      endBatch()

      expect(effectCount).toBe(2) // Only one additional effect trigger
      expect(sum).toBe(60)
    })
  })

  describe('Legacy ReactiveStore compatibility', () => {
    it('should support ReactiveStore API', () => {
      // ReactiveStore is already imported at the top
      const store = new ReactiveStore()

      store.set('users', 1, { name: 'John', age: 30 })
      const userSignal = store.find('users', 1)

      expect(userSignal).toBeDefined()
      expect(userSignal!().name).toBe('John')
      expect(userSignal!().age).toBe(30)

      let effectCount = 0
      let userName = ''

      effect(() => {
        userName = userSignal!().name
        effectCount++
      })

      expect(effectCount).toBe(1)
      expect(userName).toBe('John')

      userSignal!().name = 'Jane'
      expect(effectCount).toBe(2)
      expect(userName).toBe('Jane')
    })
  })
})
