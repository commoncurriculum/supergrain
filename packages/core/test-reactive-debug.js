import { createStore } from './dist/index.es.js'
import { effect } from 'alien-signals'

console.log('Testing reactive tracking with debugging...\n')

// Test 1: Basic reactivity with debugging
console.log('Test 1: Basic reactivity - debugging signal updates')
const [store1, setStore1] = createStore({ value: 42 })

// Check if the store has the $NODE symbol
const NODE_SYMBOL = Symbol.for('store-node')
const nodes1 = store1[NODE_SYMBOL] || store1[Object.getOwnPropertySymbols(store1).find(s => s.toString() === 'Symbol(store-node)')]
console.log('  Store has nodes?', !!nodes1)
if (nodes1) {
  console.log('  Nodes object:', nodes1)
  console.log('  value signal exists?', !!nodes1.value)
  if (nodes1.value) {
    console.log('  Initial signal value:', nodes1.value())
  }
}

let effectRuns1 = 0
let lastValue1 = 0

const dispose1 = effect(() => {
  effectRuns1++
  lastValue1 = store1.value
  console.log(`  Effect run #${effectRuns1}, value: ${lastValue1}`)
})

console.log(`  Initial effect runs: ${effectRuns1}`)

// Before update
console.log('\n  Before setStore:')
if (nodes1?.value) {
  console.log('    Signal value:', nodes1.value())
}
console.log('    Store value:', store1.value)

// Do the update
console.log('\n  Calling setStore("value", 43)...')
setStore1('value', 43)

// After update
console.log('\n  After setStore:')
if (nodes1?.value) {
  console.log('    Signal value:', nodes1.value())
}
console.log('    Store value:', store1.value)
console.log('    Effect runs:', effectRuns1)

// Try manual signal update to see if effect works
if (nodes1?.value) {
  console.log('\n  Trying manual signal update...')
  nodes1.value(44)
  console.log('    Signal value after manual update:', nodes1.value())
  console.log('    Effect runs after manual update:', effectRuns1)
}

dispose1()
console.log()

// Test 2: Check if setProperty is actually being called
console.log('Test 2: Trace setStore execution')
const [store2, setStore2] = createStore({ count: 0 })

// Monkey-patch to trace execution
const originalSet = store2.constructor.prototype.__lookupSetter__ ?
  store2.constructor.prototype.__lookupSetter__('count') : null
console.log('  Has setter?', !!originalSet)

let effectRuns2 = 0
const dispose2 = effect(() => {
  effectRuns2++
  const count = store2.count
  console.log(`  Effect run #${effectRuns2}, count: ${count}`)
})

console.log('  Initial effect runs:', effectRuns2)

// Log what setStore actually does
console.log('\n  Calling setStore with debugging...')
console.log('  setStore type:', typeof setStore2)
console.log('  setStore is function?', typeof setStore2 === 'function')

// Call it
setStore2('count', 1)

console.log('  After setStore: effect runs =', effectRuns2)
console.log('  Store count value:', store2.count)

dispose2()

// Test 3: Check if the proxy handler is working
console.log('\nTest 3: Direct property assignment')
const [store3] = createStore({ value: 100 })

let effectRuns3 = 0
const dispose3 = effect(() => {
  effectRuns3++
  const val = store3.value
  console.log(`  Effect run #${effectRuns3}, value: ${val}`)
})

console.log('  Initial effect runs:', effectRuns3)

// Try direct assignment (which should go through proxy set trap)
console.log('  Trying direct assignment: store3.value = 200')
store3.value = 200

console.log('  After direct assignment: effect runs =', effectRuns3)
console.log('  Store value:', store3.value)

dispose3()

// Test 4: Check array operations
console.log('\nTest 4: Array push operation')
const [store4] = createStore({ items: [] })

let effectRuns4 = 0
const dispose4 = effect(() => {
  effectRuns4++
  const len = store4.items.length
  console.log(`  Effect run #${effectRuns4}, length: ${len}`)
})

console.log('  Initial effect runs:', effectRuns4)

console.log('  Pushing item...')
store4.items.push(1)

console.log('  After push: effect runs =', effectRuns4)
console.log('  Array length:', store4.items.length)
console.log('  Array contents:', store4.items)

dispose4()
