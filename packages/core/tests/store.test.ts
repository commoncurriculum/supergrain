import { describe, it, expect, beforeEach } from 'vitest'
import { ReactiveStore } from '../src/store'
import { Signal } from '@preact/signals-core'

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
    expect(userSignal).toBeInstanceOf(Signal)
    expect(userSignal!.value).toEqual(userData)
  })

  it('should update an existing entity', () => {
    const initialUserData = { name: 'John Doe', age: 30 }
    store.set('users', '1', initialUserData)

    const updatedUserData = { name: 'John Doe', age: 31 }
    store.set('users', '1', updatedUserData)

    const userSignal = store.find('users', '1')
    expect(userSignal).toBeDefined()
    expect(userSignal!.value).toEqual(updatedUserData)
    expect(userSignal!.value).not.toEqual(initialUserData)
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
    expect(item1Signal!.value).toEqual(userData1)
    expect(item2Signal).toBeDefined()
    expect(item2Signal!.value).toEqual(userData2)
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

    expect(userSignal!.value).toEqual(userData)
    expect(postSignal!.value).toEqual(postData)
    expect(missingPostSignal).toBeUndefined()
    expect(missingUserSignal).toBeUndefined()
  })
})
