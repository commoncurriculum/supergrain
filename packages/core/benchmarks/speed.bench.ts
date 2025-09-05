import { bench, describe } from 'vitest'
import { ReactiveStore } from '../src/store'
import { effect } from 'alien-signals'

describe('Speed Benchmarks', () => {
  describe('Store Operations', () => {
    bench('set(): creating 1,000 entities', () => {
      const store = new ReactiveStore()
      for (let i = 0; i < 1000; i++) {
        store.set('users', i, { name: `User ${i}`, age: i })
      }
    })

    bench('find(): retrieving 1,000 entities', () => {
      const store = new ReactiveStore()
      for (let i = 0; i < 1000; i++) {
        store.set('users', i, { name: `User ${i}`, age: i })
      }

      for (let i = 0; i < 1000; i++) {
        store.find('users', i)
      }
    })
  })

  describe('Proxy Reactivity', () => {
    bench('property access: 10,000 reads', () => {
      const store = new ReactiveStore()
      store.set('users', '1', { name: 'John Doe' })
      const user = store.find('users', '1')!()

      let dummy
      effect(() => {
        for (let i = 0; i < 10000; i++) {
          dummy = user.name
        }
      })
    })

    bench('property mutation: 1,000 updates triggering an effect', () => {
      const store = new ReactiveStore()
      store.set('users', '1', { name: 'John Doe', age: 30 })
      const user = store.find('users', '1')!()

      let dummy
      effect(() => {
        dummy = user.age
      })

      for (let i = 0; i < 1000; i++) {
        user.age = i
      }
    })
  })

  describe('Array Reactivity', () => {
    bench('push(): adding 1,000 items to an array', () => {
      const store = new ReactiveStore()
      store.set('posts', 'all', { items: [] })
      const posts = store.find('posts', 'all')!().items

      for (let i = 0; i < 1000; i++) {
        posts.push({ id: i, title: `Post ${i}` })
      }
    })

    bench('splice(): removing 1,000 items from an array', () => {
      const store = new ReactiveStore()
      const initialItems = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        title: `Post ${i}`,
      }))
      store.set('posts', 'all', { items: initialItems })
      const posts = store.find('posts', 'all')!().items

      // Splice one by one from the end
      for (let i = 0; i < 1000; i++) {
        posts.splice(posts.length - 1, 1)
      }
    })
  })
})
