import { createStore } from './dist/index.es.js'
import { effect } from 'alien-signals'

console.log('Testing reactive tracking...\n')

// Test 1: Basic reactivity
console.log('Test 1: Basic reactivity')
const [store1, setStore1] = createStore({ value: 42 })
let effectRuns1 = 0
let lastValue1 = 0

const dispose1 = effect(() => {
  effectRuns1++
  lastValue1 = store1.value
  console.log(`  Effect run #${effectRuns1}, value: ${lastValue1}`)
})

console.log(`  Initial effect runs: ${effectRuns1} (expected: 1)`)

setStore1('value', 43)
console.log(
  `  After setStore('value', 43): effect runs = ${effectRuns1} (expected: 2)`
)

dispose1()
console.log()

// Test 2: Array length tracking
console.log('Test 2: Array length tracking')
const [store2] = createStore({ items: [] })
let effectRuns2 = 0
let lastLength = 0

const dispose2 = effect(() => {
  effectRuns2++
  lastLength = store2.items.length
  console.log(`  Effect run #${effectRuns2}, length: ${lastLength}`)
})

console.log(`  Initial effect runs: ${effectRuns2} (expected: 1)`)

store2.items.push(1)
console.log(`  After push(1): effect runs = ${effectRuns2} (expected: 2)`)

store2.items.push(2)
console.log(`  After push(2): effect runs = ${effectRuns2} (expected: 3)`)

dispose2()
console.log()

// Test 3: Multiple property tracking
console.log('Test 3: Multiple property tracking')
const [store3, setStore3] = createStore({ a: 1, b: 2, c: 3 })
let effectRuns3 = 0

const dispose3 = effect(() => {
  effectRuns3++
  const sum = store3.a + store3.b + store3.c
  console.log(`  Effect run #${effectRuns3}, sum: ${sum}`)
})

console.log(`  Initial effect runs: ${effectRuns3} (expected: 1)`)

setStore3('a', 10)
console.log(
  `  After setStore('a', 10): effect runs = ${effectRuns3} (expected: 2)`
)

setStore3('b', 20)
console.log(
  `  After setStore('b', 20): effect runs = ${effectRuns3} (expected: 3)`
)

dispose3()
console.log()

// Test 4: Batch updates
console.log('Test 4: Batch updates')
const [store4, setStore4] = createStore({ count: 0 })
let effectRuns4 = 0

const dispose4 = effect(() => {
  effectRuns4++
  const count = store4.count
  console.log(`  Effect run #${effectRuns4}, count: ${count}`)
})

console.log(`  Initial effect runs: ${effectRuns4} (expected: 1)`)

// Multiple updates in a loop - should trigger effect each time
for (let i = 1; i <= 3; i++) {
  setStore4('count', i)
}
console.log(`  After 3 updates: effect runs = ${effectRuns4} (expected: 4)`)

dispose4()
