import { createStore as createSolidStore } from 'solid-js/store'
import {
  createEffect as createSolidEffect,
  createRoot,
  createSignal,
  batch,
  runWithOwner,
  getOwner,
  createMemo,
  onMount,
} from 'solid-js'
import { createStore } from './src/store-optimized'
import { effect } from 'alien-signals'

console.log('Testing Solid.js setup to ensure it works properly...\n')

// Test 1: Basic Solid.js signal test
console.log('=== Test 1: Basic Solid.js Signal ===')
{
  let effectRuns = 0
  let value = 0

  const dispose = createRoot(dispose => {
    const [getCount, setCount] = createSignal(0)
    const owner = getOwner()

    // Try running effect immediately with owner
    runWithOwner(owner!, () => {
      createSolidEffect(() => {
        value = getCount()
        effectRuns++
        console.log(`Effect run #${effectRuns}: value = ${value}`)
      })
    })

    console.log('Setting signal to 10')
    setCount(10)

    console.log('Setting signal to 20')
    setCount(20)

    return dispose
  })

  // Trigger cleanup
  dispose()

  console.log(`Final: effectRuns = ${effectRuns}, value = ${value}`)
}

// Test 2: Solid.js store test
console.log('\n=== Test 2: Solid.js Store ===')
{
  let storeEffectRuns = 0
  let storeValue = 0

  const dispose = createRoot(dispose => {
    const [store, setStore] = createSolidStore({ count: 0 })

    // Use createMemo to force evaluation
    const memo = createMemo(() => {
      storeValue = store.count
      storeEffectRuns++
      console.log(`Store effect run #${storeEffectRuns}: count = ${storeValue}`)
      return storeValue
    })

    // Force initial evaluation
    memo()

    console.log('Setting store.count to 5')
    setStore('count', 5)
    memo() // Force re-evaluation

    console.log('Setting store.count to 15')
    setStore('count', 15)
    memo() // Force re-evaluation

    return dispose
  })

  dispose()

  console.log(
    `Final: storeEffectRuns = ${storeEffectRuns}, storeValue = ${storeValue}`
  )
}

// Test 3: Performance comparison - Reactive reads
console.log('\n=== Test 3: Reactive Reads Performance ===')

// Our implementation
{
  const [store] = createStore({ user: { name: 'John', age: 30 } })

  const start = performance.now()
  let sum = 0
  const dispose = effect(() => {
    for (let i = 0; i < 10000; i++) {
      sum += store.user.age
    }
  })
  const end = performance.now()

  console.log(`@storable/core: 10k reactive reads`)
  console.log(`  Time: ${(end - start).toFixed(3)}ms`)
  console.log(`  Sum: ${sum}`)
  dispose()
}

// Solid.js implementation
{
  let solidTime = 0
  let solidSum = 0

  const dispose = createRoot(dispose => {
    const [store] = createSolidStore({ user: { name: 'John', age: 30 } })

    const start = performance.now()
    // Use createMemo to force immediate evaluation
    const memo = createMemo(() => {
      solidSum = 0
      for (let i = 0; i < 10000; i++) {
        solidSum += store.user.age
      }
      return solidSum
    })
    memo() // Force evaluation
    const end = performance.now()
    solidTime = end - start
    return dispose
  })

  dispose()

  console.log(`solid-js/store: 10k reactive reads`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Sum: ${solidSum}`)
}

// Test 4: Performance comparison - Updates with effects
console.log('\n=== Test 4: Updates Performance ===')

// Our implementation
{
  const [store, setStore] = createStore({ counter: 0 })
  let effectRuns = 0
  let lastValue = 0

  const dispose = effect(() => {
    lastValue = store.counter
    effectRuns++
  })

  const start = performance.now()
  for (let i = 1; i <= 1000; i++) {
    setStore('counter', i)
  }
  const end = performance.now()

  console.log(`@storable/core: 1000 updates`)
  console.log(`  Time: ${(end - start).toFixed(3)}ms`)
  console.log(`  Effect runs: ${effectRuns}`)
  console.log(`  Last value: ${lastValue}`)
  dispose()
}

// Solid.js implementation
{
  let solidTime = 0
  let solidEffectRuns = 0
  let solidLastValue = 0

  const dispose = createRoot(dispose => {
    const [store, setStore] = createSolidStore({ counter: 0 })

    // Use createMemo for immediate evaluation
    const memo = createMemo(() => {
      solidLastValue = store.counter
      solidEffectRuns++
      return solidLastValue
    })
    memo() // Initial evaluation

    const start = performance.now()
    for (let i = 1; i <= 1000; i++) {
      setStore('counter', i)
      memo() // Force evaluation after each update
    }
    const end = performance.now()
    solidTime = end - start
    return dispose
  })

  dispose()

  console.log(`solid-js/store: 1000 updates`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Effect runs: ${solidEffectRuns}`)
  console.log(`  Last value: ${solidLastValue}`)
}

// Test 5: Batching comparison
console.log('\n=== Test 5: Batching Test ===')

// Solid.js batching
{
  let batchedRuns = 0
  let unbatchedRuns = 0

  const dispose = createRoot(dispose => {
    const [store, setStore] = createSolidStore({ a: 0, b: 0, c: 0 })

    // Unbatched with memo
    const memo1 = createMemo(() => {
      const sum = store.a + store.b + store.c
      unbatchedRuns++
      return sum
    })
    memo1() // Initial

    console.log('Solid unbatched updates:')
    setStore('a', 1)
    memo1()
    setStore('b', 2)
    memo1()
    setStore('c', 3)
    memo1()
    console.log(`  Effect runs: ${unbatchedRuns}`)

    // Reset counter for batched test
    const memo2 = createMemo(() => {
      const sum = store.a + store.b + store.c
      batchedRuns++
      return sum
    })
    memo2() // Initial

    console.log('Solid batched updates:')
    batch(() => {
      setStore('a', 10)
      setStore('b', 20)
      setStore('c', 30)
    })
    memo2() // Evaluate after batch
    console.log(`  Effect runs after batch: ${batchedRuns - 1}`) // -1 for initial run

    return dispose
  })

  dispose()
}
