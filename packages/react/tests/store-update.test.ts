import { describe, it, expect } from 'vitest'
import { createStore } from '@storable/core'

describe('Store Update Mechanism', () => {
  it('should verify store updates actually change values', () => {
    const [store, update] = createStore({ count: 0 })

    // Check initial value
    console.log('Initial store.count:', store.count)
    expect(store.count).toBe(0)

    // Update using $set
    update({ $set: { count: 5 } })
    console.log('After $set update, store.count:', store.count)
    expect(store.count).toBe(5)

    // Update again
    update({ $set: { count: 10 } })
    console.log('After second $set update, store.count:', store.count)
    expect(store.count).toBe(10)
  })

  it('should test $inc operator', () => {
    const [store, update] = createStore({ value: 10 })

    expect(store.value).toBe(10)

    update({ $inc: { value: 5 } })
    console.log('After $inc by 5, store.value:', store.value)
    expect(store.value).toBe(15)

    update({ $inc: { value: -3 } })
    console.log('After $inc by -3, store.value:', store.value)
    expect(store.value).toBe(12)
  })

  it('should test nested object updates', () => {
    const [store, update] = createStore({
      user: {
        name: 'Alice',
        age: 30,
      },
    })

    expect(store.user.name).toBe('Alice')
    expect(store.user.age).toBe(30)

    // Update nested property using dot notation
    update({ $set: { 'user.name': 'Bob' } })
    console.log('After updating user.name:', store.user.name)
    expect(store.user.name).toBe('Bob')
    expect(store.user.age).toBe(30) // Should remain unchanged

    // Update another nested property
    update({ $set: { 'user.age': 31 } })
    console.log('After updating user.age:', store.user.age)
    expect(store.user.age).toBe(31)
    expect(store.user.name).toBe('Bob')
  })

  it('should test array operations', () => {
    const [store, update] = createStore({
      items: ['a', 'b', 'c'],
    })

    expect(store.items).toEqual(['a', 'b', 'c'])

    // Test $push
    update({ $push: { items: 'd' } })
    console.log('After $push, store.items:', store.items)
    expect(store.items).toEqual(['a', 'b', 'c', 'd'])

    // Test $pull (if supported)
    update({ $pull: { items: 'b' } })
    console.log('After $pull, store.items:', store.items)
    expect(store.items).toEqual(['a', 'c', 'd'])
  })

  it('should test multiple properties update', () => {
    const [store, update] = createStore({
      x: 1,
      y: 2,
      z: 3,
    })

    expect(store.x).toBe(1)
    expect(store.y).toBe(2)
    expect(store.z).toBe(3)

    // Update multiple properties at once
    update({ $set: { x: 10, y: 20 } })
    console.log('After multi-update:', { x: store.x, y: store.y, z: store.z })
    expect(store.x).toBe(10)
    expect(store.y).toBe(20)
    expect(store.z).toBe(3) // Should remain unchanged
  })

  it('should verify store is actually reactive (proxy)', () => {
    const [store] = createStore({ test: 'value' })

    // Check if the store is a Proxy
    console.log('Store type:', typeof store)
    console.log('Store constructor:', store.constructor.name)
    console.log('Is store an object?', typeof store === 'object')

    // Try to check if it's a proxy (indirect check)
    const isProxy = store.constructor.name !== 'Object'
    console.log(
      'Likely a proxy?',
      isProxy || store.toString() === '[object Object]'
    )
  })
})
