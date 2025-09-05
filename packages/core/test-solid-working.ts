import { createStore as createSolidStore } from 'solid-js/store'
import {
  createEffect as createSolidEffect,
  createRoot,
  createSignal,
  batch,
  createComputed,
  untrack,
} from 'solid-js'
import { createStore } from './src/store-optimized'
import { effect } from 'alien-signals'

console.log('Testing Solid.js with synchronous execution...\n')

// Helper to run Solid code synchronously
function runSolidSync<T>(fn: () => T): T {
  let result: T
  let hasRun = false

  const dispose = createRoot(dispose => {
    // Force synchronous execution by using createComputed
    // which runs immediately unlike createEffect
    createComputed(() => {
      if (!hasRun) {
        hasRun = true
        result = fn()
      }
    })
    return dispose
  })

  dispose()
  return result!
}

// Test 1: Verify Solid.js works with createComputed
console.log('=== Test 1: Solid.js with createComputed ===')
{
  let computedRuns = 0
  let value = 0

  const dispose = createRoot(dispose => {
    const [getCount, setCount] = createSignal(0)

    // createComputed runs synchronously
    createComputed(() => {
      value = getCount()
      computedRuns++
      console.log(`Computed run #${computedRuns}: value = ${value}`)
    })

    console.log('Setting signal to 10')
    setCount(10)

    console.log('Setting signal to 20')
    setCount(20)

    return dispose
  })

  dispose()
  console.log(`Final: computedRuns = ${computedRuns}, value = ${value}`)
}

// Test 2: Performance comparison using createComputed
console.log('\n=== Test 2: Reactive Reads Performance (Synchronous) ===')

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

// Solid.js with createComputed (synchronous)
{
  let solidTime = 0
  let solidSum = 0

  const dispose = createRoot(dispose => {
    const [store] = createSolidStore({ user: { name: 'John', age: 30 } })

    const start = performance.now()
    createComputed(() => {
      solidSum = 0
      for (let i = 0; i < 10000; i++) {
        solidSum += store.user.age
      }
    })
    const end = performance.now()
    solidTime = end - start

    return dispose
  })

  dispose()
  console.log(`solid-js/store: 10k reactive reads (computed)`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Sum: ${solidSum}`)
}

// Test 3: Updates performance with createComputed
console.log('\n=== Test 3: Updates Performance (Synchronous) ===')

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

// Solid.js with createComputed
{
  let solidTime = 0
  let solidEffectRuns = 0
  let solidLastValue = 0

  const dispose = createRoot(dispose => {
    const [store, setStore] = createSolidStore({ counter: 0 })

    createComputed(() => {
      solidLastValue = store.counter
      solidEffectRuns++
    })

    const start = performance.now()
    for (let i = 1; i <= 1000; i++) {
      setStore('counter', i)
    }
    const end = performance.now()
    solidTime = end - start

    return dispose
  })

  dispose()
  console.log(`solid-js/store: 1000 updates (computed)`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Effect runs: ${solidEffectRuns}`)
  console.log(`  Last value: ${solidLastValue}`)
}

// Test 4: Deep property access
console.log('\n=== Test 4: Deep Property Access ===')

// Our implementation
{
  const [store] = createStore({
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              value: 42,
            },
          },
        },
      },
    },
  })

  const start = performance.now()
  let result = 0
  const dispose = effect(() => {
    for (let i = 0; i < 1000; i++) {
      result = store.level1.level2.level3.level4.level5.value
    }
  })
  const end = performance.now()

  console.log(`@storable/core: 1k deep reactive reads`)
  console.log(`  Time: ${(end - start).toFixed(3)}ms`)
  console.log(`  Result: ${result}`)
  dispose()
}

// Solid.js deep access
{
  let solidTime = 0
  let solidResult = 0

  const dispose = createRoot(dispose => {
    const [store] = createSolidStore({
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                value: 42,
              },
            },
          },
        },
      },
    })

    const start = performance.now()
    createComputed(() => {
      for (let i = 0; i < 1000; i++) {
        solidResult = store.level1.level2.level3.level4.level5.value
      }
    })
    const end = performance.now()
    solidTime = end - start

    return dispose
  })

  dispose()
  console.log(`solid-js/store: 1k deep reactive reads (computed)`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Result: ${solidResult}`)
}

// Test 5: Non-reactive reads comparison
console.log('\n=== Test 5: Non-Reactive Reads ===')

// Our implementation
{
  const [store] = createStore({ value: 100 })

  const iterations = 100000
  const start = performance.now()
  let sum = 0
  for (let i = 0; i < iterations; i++) {
    sum += store.value
  }
  const end = performance.now()

  console.log(`@storable/core: ${iterations} non-reactive reads`)
  console.log(`  Time: ${(end - start).toFixed(3)}ms`)
  console.log(`  Sum: ${sum}`)
}

// Solid.js non-reactive
{
  let solidTime = 0
  let solidSum = 0

  const dispose = createRoot(dispose => {
    const [store] = createSolidStore({ value: 100 })

    const iterations = 100000
    const start = performance.now()
    // Use untrack to prevent tracking
    untrack(() => {
      for (let i = 0; i < iterations; i++) {
        solidSum += store.value
      }
    })
    const end = performance.now()
    solidTime = end - start

    return dispose
  })

  dispose()
  console.log(`solid-js/store: 100000 non-reactive reads`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Sum: ${solidSum}`)
}

// Test 6: Array operations
console.log('\n=== Test 6: Array Operations ===')

// Our implementation
{
  const [store] = createStore({ items: [1, 2, 3, 4, 5] })

  let lengthChecks = 0
  const dispose = effect(() => {
    const len = store.items.length
    lengthChecks++
  })

  const start = performance.now()
  for (let i = 0; i < 100; i++) {
    store.items.push(i)
  }
  const end = performance.now()

  console.log(`@storable/core: 100 array pushes`)
  console.log(`  Time: ${(end - start).toFixed(3)}ms`)
  console.log(`  Length checks: ${lengthChecks}`)
  console.log(`  Final length: ${store.items.length}`)
  dispose()
}

// Solid.js arrays
{
  let solidTime = 0
  let solidLengthChecks = 0
  let finalLength = 0

  const dispose = createRoot(dispose => {
    const [store, setStore] = createSolidStore({ items: [1, 2, 3, 4, 5] })

    createComputed(() => {
      const len = store.items.length
      solidLengthChecks++
    })

    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      setStore('items', items => [...items, i])
    }
    const end = performance.now()
    solidTime = end - start
    finalLength = store.items.length

    return dispose
  })

  dispose()
  console.log(`solid-js/store: 100 array pushes`)
  console.log(`  Time: ${solidTime.toFixed(3)}ms`)
  console.log(`  Length checks: ${solidLengthChecks}`)
  console.log(`  Final length: ${finalLength}`)
}
