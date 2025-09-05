import { createStore, effect } from './src/index.js'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'

console.log('Simple Performance Test\n')

// Test 1: Reactive property reads
console.log('Test 1: 10,000 reactive property reads')

// @storable/core
const [store] = createStore({
  user: { name: 'John', age: 30, email: 'john@example.com' }
})

let storableReadCount = 0
const start1 = performance.now()
effect(() => {
  for (let i = 0; i < 10000; i++) {
    const _ = store.user.name
    storableReadCount++
  }
})
const end1 = performance.now()
console.log(`@storable/core: ${end1 - start1}ms for ${storableReadCount} reads`)

// Solid.js
createRoot(() => {
  const [solidStore] = createSolidStore({
    user: { name: 'John', age: 30, email: 'john@example.com' }
  })

  let solidReadCount = 0
  const start2 = performance.now()
  createSolidEffect(() => {
    for (let i = 0; i < 10000; i++) {
      const _ = solidStore.user.name
      solidReadCount++
    }
  })
  const end2 = performance.now()
  console.log(`solid-js/store: ${end2 - start2}ms for ${solidReadCount} reads`)

  const ratio = (end1 - start1) / (end2 - start2)
  console.log(`Ratio: @storable/core is ${ratio.toFixed(1)}x slower\n`)
})

// Test 2: Array operations
console.log('Test 2: Array push operations')

const [store2] = createStore({ items: [] })
let pushCount = 0

const start3 = performance.now()
effect(() => {
  const _ = store2.items.length
  pushCount++
})

for (let i = 0; i < 1000; i++) {
  store2.items.push(i)
}
const end3 = performance.now()
console.log(`@storable/core: ${end3 - start3}ms for 1000 pushes (${pushCount} effect runs)`)

// Solid.js array test
createRoot(() => {
  const [solidStore2] = createSolidStore({ items: [] })
  let solidPushCount = 0

  const start4 = performance.now()
  createSolidEffect(() => {
    const _ = solidStore2.items.length
    solidPushCount++
  })

  for (let i = 0; i < 1000; i++) {
    solidStore2.items.push(i)
  }
  const end4 = performance.now()
  console.log(`solid-js/store: ${end4 - start4}ms for 1000 pushes (${solidPushCount} effect runs)`)

  const ratio2 = (end3 - start3) / (end4 - start4)
  console.log(`Ratio: @storable/core is ${ratio2.toFixed(1)}x slower\n`)
})

// Test 3: Property updates
console.log('Test 3: 1000 property updates')

const [store3, setStore3] = createStore({ count: 0 })
let updateCount = 0

const start5 = performance.now()
effect(() => {
  const _ = store3.count
  updateCount++
})

for (let i = 0; i < 1000; i++) {
  setStore3('count', i)
}
const end5 = performance.now()
console.log(`@storable/core: ${end5 - start5}ms for 1000 updates (${updateCount} effect runs)`)

// Solid.js update test
createRoot(() => {
  const [solidStore3, setSolidStore3] = createSolidStore({ count: 0 })
  let solidUpdateCount = 0

  const start6 = performance.now()
  createSolidEffect(() => {
    const _ = solidStore3.count
    solidUpdateCount++
  })

  for (let i = 0; i < 1000; i++) {
    setSolidStore3('count', i)
  }
  const end6 = performance.now()
  console.log(`solid-js/store: ${end6 - start6}ms for 1000 updates (${solidUpdateCount} effect runs)`)

  const ratio3 = (end5 - start5) / (end6 - start6)
  console.log(`Ratio: @storable/core is ${ratio3.toFixed(1)}x slower`)
})
