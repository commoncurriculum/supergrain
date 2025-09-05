import { bench, describe } from 'vitest'
import { ReactiveStore } from '../src/store'

describe('Proxy vs. Plain Object Overhead', () => {
  // --- Property Access & Mutation Benchmarks ---
  describe('Object Property Access', () => {
    const plainObject = { name: 'John Doe' }
    const store = new ReactiveStore()
    store.set('users', '1', { name: 'John Doe' })
    const proxyObject = store.find('users', '1')!()

    bench('Plain Object: 10,000 property reads', () => {
      for (let i = 0; i < 10000; i++) {
        const name = plainObject.name
      }
    })

    bench('Proxy Object: 10,000 property reads', () => {
      for (let i = 0; i < 10000; i++) {
        const name = proxyObject.name
      }
    })
  })

  describe('Object Property Mutation', () => {
    const plainObject = { age: 0 }
    const store = new ReactiveStore()
    store.set('users', '1', { age: 0 })
    const proxyObject = store.find('users', '1')!()

    bench('Plain Object: 10,000 property writes', () => {
      for (let i = 0; i < 10000; i++) {
        plainObject.age = i
      }
    })

    bench('Proxy Object: 10,000 property writes', () => {
      for (let i = 0; i < 10000; i++) {
        proxyObject.age = i
      }
    })
  })

  // --- Array Operation Benchmarks ---
  describe('Array Index Access', () => {
    const plainArray = Array.from({ length: 1000 }, (_, i) => i)
    const store = new ReactiveStore()
    store.set('numbers', 'all', {
      items: Array.from({ length: 1000 }, (_, i) => i),
    })
    const proxyArray = store.find('numbers', 'all')!().items

    bench('Plain Array: 10,000 index reads', () => {
      for (let i = 0; i < 10000; i++) {
        const item = plainArray[i % 1000]
      }
    })

    bench('Proxy Array: 10,000 index reads', () => {
      for (let i = 0; i < 10000; i++) {
        const item = proxyArray[i % 1000]
      }
    })
  })

  describe('Array Push', () => {
    bench('Plain Array: pushing 1,000 items', () => {
      const arr: number[] = []
      for (let i = 0; i < 1000; i++) {
        arr.push(i)
      }
    })

    bench('Proxy Array: pushing 1,000 items', () => {
      const store = new ReactiveStore()
      store.set('items', 'all', { list: [] })
      const proxyArr = store.find('items', 'all')!().list
      for (let i = 0; i < 1000; i++) {
        proxyArr.push(i)
      }
    })
  })
})
