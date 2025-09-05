import { bench, describe } from 'vitest'
import { createStore } from '../src/store'

describe('Proxy Overhead Benchmarks', () => {
  describe('Object Property Access', () => {
    const plainObject = { name: 'John Doe' }
    const [proxyObject] = createStore({ name: 'John Doe' })

    bench('plain object: property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = plainObject.name
      }
    })

    bench('proxy object: property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = proxyObject.name
      }
    })
  })

  describe('Object Property Write', () => {
    bench('plain object: property write', () => {
      const obj = { count: 0 }
      for (let i = 0; i < 100000; i++) {
        obj.count = i
      }
    })

    bench('proxy object: property write', () => {
      const [obj] = createStore({ count: 0 })
      for (let i = 0; i < 100000; i++) {
        obj.count = i
      }
    })
  })

  describe('Array Operations', () => {
    bench('plain array: push operation', () => {
      const plainArray = Array.from({ length: 1000 }, (_, i) => i)
      for (let i = 0; i < 1000; i++) {
        plainArray.push(i)
      }
    })

    bench('proxy array: push operation', () => {
      const [store] = createStore({
        items: Array.from({ length: 1000 }, (_, i) => i),
      })
      for (let i = 0; i < 1000; i++) {
        store.items.push(i)
      }
    })

    bench('plain array: splice operation', () => {
      const plainArray = Array.from({ length: 1000 }, (_, i) => i)
      for (let i = 0; i < 100; i++) {
        plainArray.splice(0, 1)
      }
    })

    bench('proxy array: splice operation', () => {
      const [store] = createStore({
        items: Array.from({ length: 1000 }, (_, i) => i),
      })
      for (let i = 0; i < 100; i++) {
        store.items.splice(0, 1)
      }
    })
  })

  describe('Deep Object Access', () => {
    const plainDeep = {
      level1: {
        level2: {
          level3: {
            value: 42,
          },
        },
      },
    }

    const [proxyDeep] = createStore({
      level1: {
        level2: {
          level3: {
            value: 42,
          },
        },
      },
    })

    bench('plain object: deep property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = plainDeep.level1.level2.level3.value
      }
    })

    bench('proxy object: deep property read', () => {
      let value
      for (let i = 0; i < 100000; i++) {
        value = proxyDeep.level1.level2.level3.value
      }
    })
  })
})
