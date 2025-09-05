import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect, createRoot, createSignal } from 'solid-js'

console.log('Testing Solid.js behavior to understand its optimization...\n')

// Test 1: Check if Solid actually runs effects immediately
console.log('=== Test 1: When do effects run? ===')
createRoot(() => {
  const [store, setStore] = createSolidStore({ count: 0 })

  console.log('Before creating effect')

  let runCount = 0
  createEffect(() => {
    console.log(`Effect running (run #${++runCount}), count = ${store.count}`)
  })

  console.log('After creating effect')

  console.log('Setting count to 1')
  setStore('count', 1)

  console.log('Setting count to 2')
  setStore('count', 2)

  console.log('Done with test 1')
})

// Test 2: Check how Solid handles multiple reads in one effect
console.log('\n=== Test 2: Multiple reads in one effect ===')
createRoot(() => {
  const [store] = createSolidStore({ value: 10 })

  let effectRuns = 0
  let sum = 0

  console.time('Creating effect with 10k reads')
  createEffect(() => {
    effectRuns++
    sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += store.value
    }
    console.log(`Effect ran ${effectRuns} time(s), sum = ${sum}`)
  })
  console.timeEnd('Creating effect with 10k reads')
})

// Test 3: Compare with raw signals
console.log('\n=== Test 3: Raw Solid signals ===')
createRoot(() => {
  const [getValue, setValue] = createSignal(10)

  let effectRuns = 0
  let sum = 0

  console.time('Creating effect with 10k signal reads')
  createEffect(() => {
    effectRuns++
    sum = 0
    for (let i = 0; i < 10000; i++) {
      sum += getValue()
    }
    console.log(`Signal effect ran ${effectRuns} time(s), sum = ${sum}`)
  })
  console.timeEnd('Creating effect with 10k signal reads')
})

// Test 4: Check if Solid deduplicates reads
console.log('\n=== Test 4: Does Solid deduplicate repeated reads? ===')
createRoot(() => {
  const [store, setStore] = createSolidStore({ a: 1, b: 2 })

  let effectRuns = 0

  createEffect(() => {
    effectRuns++
    // Read the same property many times
    let sum = 0
    for (let i = 0; i < 100; i++) {
      sum += store.a
    }
    console.log(`Effect run #${effectRuns}: sum of 100 reads of 'a' = ${sum}`)
  })

  console.log('Updating a...')
  setStore('a', 10)

  console.log('Updating b (should not trigger effect)...')
  setStore('b', 20)

  console.log('Updating a again...')
  setStore('a', 100)
})

// Test 5: Measure actual cost of property access
console.log('\n=== Test 5: Actual cost of property access ===')
createRoot(() => {
  const [store] = createSolidStore({
    user: {
      profile: {
        data: {
          value: 42,
        },
      },
    },
  })

  // Warm up
  for (let i = 0; i < 1000; i++) {
    const _ = store.user.profile.data.value
  }

  // Measure non-reactive access
  const iterations = 1000000
  console.time(`${iterations} non-reactive deep reads`)
  let sum = 0
  for (let i = 0; i < iterations; i++) {
    sum += store.user.profile.data.value
  }
  console.timeEnd(`${iterations} non-reactive deep reads`)
  console.log(`Sum: ${sum}`)

  // Measure reactive access
  console.time('Setting up effect with 1M reads')
  let effectSum = 0
  createEffect(() => {
    effectSum = 0
    for (let i = 0; i < iterations; i++) {
      effectSum += store.user.profile.data.value
    }
  })
  console.timeEnd('Setting up effect with 1M reads')
  console.log(`Effect sum: ${effectSum}`)
})
