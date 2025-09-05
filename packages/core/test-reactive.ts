import { createStore } from './src/store-optimized'
import { effect } from 'alien-signals'
import { createStore as createSolidStore } from 'solid-js/store'
import {
  createEffect as createSolidEffect,
  createRoot,
  runWithOwner,
  getOwner,
} from 'solid-js'

console.log('Testing reactive property access performance...\n')

// Test our implementation's reactive reads
console.log('=== Reactive Reads Performance ===')
{
  const [store] = createStore({ user: { name: 'John', age: 30 } })

  const start = performance.now()
  let sum = 0
  effect(() => {
    // This runs once, reading the property 10k times in one effect
    for (let i = 0; i < 10000; i++) {
      sum += store.user.age
    }
  })
  const end = performance.now()

  console.log(
    `@storable/core: 10k reactive reads in ${(end - start).toFixed(3)}ms`
  )
  console.log(`  Result: ${sum}`)
}

// Test Solid's reactive reads
{
  createRoot(() => {
    const [store] = createSolidStore({ user: { name: 'John', age: 30 } })

    const start = performance.now()
    let sum = 0
    createSolidEffect(() => {
      // This runs once, reading the property 10k times in one effect
      for (let i = 0; i < 10000; i++) {
        sum += store.user.age
      }
    })
    const end = performance.now()

    console.log(
      `solid-js/store: 10k reactive reads in ${(end - start).toFixed(3)}ms`
    )
    console.log(`  Result: ${sum}`)
  })
}

// Performance comparison: Multiple reactive reads
console.log('\n=== Multiple Effect Triggers ===')

// Our implementation
{
  const [store, setStore] = createStore({ counter: 0 })
  let effectRuns = 0
  let lastValue = 0

  effect(() => {
    lastValue = store.counter
    effectRuns++
  })

  const start = performance.now()
  for (let i = 1; i <= 1000; i++) {
    setStore('counter', i)
  }
  const end = performance.now()

  console.log(`@storable/core: 1000 updates in ${(end - start).toFixed(3)}ms`)
  console.log(`  Effect runs: ${effectRuns}, Last value: ${lastValue}`)
}

// Solid.js
{
  createRoot(() => {
    const [store, setStore] = createSolidStore({ counter: 0 })
    let effectRuns = 0
    let lastValue = 0

    createSolidEffect(() => {
      lastValue = store.counter
      effectRuns++
    })

    const start = performance.now()
    for (let i = 1; i <= 1000; i++) {
      setStore('counter', i)
    }
    const end = performance.now()

    console.log(`solid-js/store: 1000 updates in ${(end - start).toFixed(3)}ms`)
    console.log(`  Effect runs: ${effectRuns}, Last value: ${lastValue}`)
  })
}

// Test if our reactive system is working correctly
console.log('\n=== Reactive System Verification ===')
{
  const [store, setStore] = createStore({ value: 10 })
  let runCount = 0
  let total = 0

  const dispose = effect(() => {
    // Access the value multiple times
    for (let i = 0; i < 100; i++) {
      total += store.value
    }
    runCount++
  })

  console.log(`Initial: runCount=${runCount}, total=${total}`)

  setStore('value', 20)
  console.log(`After update to 20: runCount=${runCount}, total=${total}`)

  setStore('value', 30)
  console.log(`After update to 30: runCount=${runCount}, total=${total}`)

  dispose()
}
