import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ReactiveStore, Signal } from '../src/store'
import { effect } from 'alien-signals'

describe('ReactiveStore', () => {
  let store: ReactiveStore

  beforeEach(() => {
    store = new ReactiveStore()
  })

  it('should create a new collection if it does not exist', () => {
    const usersCollection = store.collection('users')
    expect(usersCollection).toBeInstanceOf(Map)
    expect(usersCollection.size).toBe(0)
  })

  it('should return an existing collection', () => {
    const usersCollection1 = store.collection('users')
    const usersCollection2 = store.collection('users')
    expect(usersCollection1).toBe(usersCollection2)
  })

  it('should set and find an entity', () => {
    const userData = { name: 'John Doe', age: 30 }
    store.set('users', '1', userData)

    const userSignal = store.find('users', '1')
    expect(userSignal).toBeDefined()
    expect(userSignal).toBeInstanceOf(Function)
    expect(userSignal!()).toEqual(userData)
  })

  it('should update an existing entity', () => {
    const initialUserData = { name: 'John Doe', age: 30 }
    store.set('users', '1', initialUserData)

    const updatedUserData = { name: 'John Doe', age: 31 }
    store.set('users', '1', updatedUserData)

    const userSignal = store.find('users', '1')
    expect(userSignal).toBeDefined()
    expect(userSignal!()).toEqual(updatedUserData)
    expect(userSignal!()).not.toEqual(initialUserData)
  })

  it('should return undefined when finding a non-existent entity', () => {
    const userSignal = store.find('users', '1')
    expect(userSignal).toBeUndefined()
  })

  it('should return undefined when finding an entity in a non-existent collection', () => {
    // Note: The `find` method should not create the collection.
    const userSignal = store.find('nonExistentType', '1')
    expect(userSignal).toBeUndefined()
  })

  it('should handle different entity IDs (string and number)', () => {
    const userData1 = { name: 'String ID' }
    const userData2 = { name: 'Number ID' }

    store.set('items', 'abc', userData1)
    store.set('items', 123, userData2)

    const item1Signal = store.find('items', 'abc')
    const item2Signal = store.find('items', 123)

    expect(item1Signal).toBeDefined()
    expect(item1Signal!()).toEqual(userData1)
    expect(item2Signal).toBeDefined()
    expect(item2Signal!()).toEqual(userData2)
  })

  it('should keep collections separate', () => {
    const userData = { name: 'User' }
    const postData = { title: 'Post' }

    store.set('users', '1', userData)
    store.set('posts', '1', postData)

    const userSignal = store.find('users', '1')
    const postSignal = store.find('posts', '1')
    const missingPostSignal = store.find('users', '2')
    const missingUserSignal = store.find('posts', '2')

    expect(userSignal!()).toEqual(userData)
    expect(postSignal!()).toEqual(postData)
    expect(missingPostSignal).toBeUndefined()
    expect(missingUserSignal).toBeUndefined()
  })
})

describe('Proxy System', () => {
  let store: ReactiveStore

  beforeEach(() => {
    store = new ReactiveStore()
    const userData = { name: 'John Doe', details: { age: 30 } }
    store.set('users', '1', userData)
  })

  it('should not mutate the original object passed to set', () => {
    const originalUserData = { name: 'John Doe' }
    store.set('users', '2', originalUserData)

    const userProxy = store.find('users', '2')!()
    userProxy.name = 'Jane Doe'

    expect(originalUserData.name).toBe('John Doe')
  })

  it('should return a proxy that tracks property access for reactivity', () => {
    const user = store.find('users', '1')!()

    let dummyName
    const nameEffect = vi.fn(() => {
      dummyName = user.name
    })
    effect(nameEffect)

    expect(dummyName).toBe('John Doe')
    expect(nameEffect).toHaveBeenCalledTimes(1)

    // Update the name, effect should run
    user.name = 'Jane Doe'
    expect(dummyName).toBe('Jane Doe')
    expect(nameEffect).toHaveBeenCalledTimes(2)
  })

  it('should only trigger effects for accessed properties', () => {
    const user = store.find('users', '1')!()

    let dummyName
    const nameEffect = vi.fn(() => {
      dummyName = user.name
    })
    effect(nameEffect)

    expect(nameEffect).toHaveBeenCalledTimes(1)

    // Update a different property, nameEffect should not run
    user.details.age = 31
    expect(nameEffect).toHaveBeenCalledTimes(1)
  })

  it('should handle nested objects with proxies for reactivity', () => {
    const user = store.find('users', '1')!()

    let dummyAge
    const ageEffect = vi.fn(() => {
      dummyAge = user.details.age
    })
    effect(ageEffect)

    expect(dummyAge).toBe(30)
    expect(ageEffect).toHaveBeenCalledTimes(1)

    // update name, ageEffect should not run
    user.name = 'John Smith'
    expect(dummyAge).toBe(30)
    expect(ageEffect).toHaveBeenCalledTimes(1)

    // update age, ageEffect should run
    user.details.age = 32
    expect(dummyAge).toBe(32)
    expect(ageEffect).toHaveBeenCalledTimes(2)
  })
})

describe('Object Handling', () => {
  let store: ReactiveStore

  beforeEach(() => {
    store = new ReactiveStore()
  })

  it('should track property addition', () => {
    const user = { name: 'John' }
    store.set('users', '1', user)
    const userProxy = store.find('users', '1')!()

    let keys: string[] = []
    const effectFn = vi.fn(() => {
      keys = Object.keys(userProxy)
    })
    effect(effectFn)

    expect(keys).toEqual(['name'])
    expect(effectFn).toHaveBeenCalledTimes(1)

    // Add a property
    userProxy.age = 30
    expect(keys).toEqual(['name', 'age'])
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should track property deletion', () => {
    const user = { name: 'John', age: 30 }
    store.set('users', '1', user)
    const userProxy = store.find('users', '1')!()

    let keys: string[] = []
    const effectFn = vi.fn(() => {
      keys = Object.keys(userProxy)
    })
    effect(effectFn)

    expect(keys).toEqual(['name', 'age'])
    expect(effectFn).toHaveBeenCalledTimes(1)

    // Delete a property
    delete userProxy.age
    expect(keys).toEqual(['name'])
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should make Object.keys reactive', () => {
    const userData = { a: 1, b: 2 }
    store.set('data', '1', userData)
    const dataProxy = store.find('data', '1')!()

    let keys: string[] = []
    const keysEffect = vi.fn(() => {
      keys = Object.keys(dataProxy)
    })

    effect(keysEffect)

    expect(keys).toEqual(['a', 'b'])
    expect(keysEffect).toHaveBeenCalledTimes(1)

    // Update existing property, should not trigger keysEffect
    dataProxy.a = 11
    expect(keysEffect).toHaveBeenCalledTimes(1)

    // Add a new property, should trigger keysEffect
    dataProxy.c = 3
    expect(keys).toEqual(['a', 'b', 'c'])
    expect(keysEffect).toHaveBeenCalledTimes(2)

    // Delete a property, should trigger keysEffect
    delete dataProxy.b
    expect(keys).toEqual(['a', 'c'])
    expect(keysEffect).toHaveBeenCalledTimes(3)
  })

  it('should track for...in loops', () => {
    const user = { name: 'John' }
    store.set('users', '1', user)
    const userProxy = store.find('users', '1')!()

    let keys: string[] = []
    const effectFn = vi.fn(() => {
      keys = []
      for (const key in userProxy) {
        keys.push(key)
      }
    })
    effect(effectFn)

    expect(keys).toEqual(['name'])
    expect(effectFn).toHaveBeenCalledTimes(1)

    // Add a property
    userProxy.age = 30
    expect(keys).toEqual(['name', 'age'])
    expect(effectFn).toHaveBeenCalledTimes(2)

    // Delete a property
    delete userProxy.age
    expect(keys).toEqual(['name'])
    expect(effectFn).toHaveBeenCalledTimes(3)
  })
})

describe('Benchmark Scenarios', () => {
  it('should handle nested arrays in proxy objects correctly', () => {
    const store = new ReactiveStore()
    store.set('numbers', 'all', {
      items: Array.from({ length: 1000 }, (_, i) => i),
    })
    const proxySignal = store.find('numbers', 'all')
    expect(proxySignal).toBeDefined()
    expect(proxySignal!()).toBeDefined()
    const proxyArray = proxySignal!().items
    expect(proxyArray).toBeInstanceOf(Array)
    expect(proxyArray.length).toBe(1000)
  })
})
