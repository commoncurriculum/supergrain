import { createStore } from './dist/index.es.js'
import { effect } from 'alien-signals'

console.log('Testing node access and symbol handling...\n')

// Test 1: Check all symbols on the store
console.log('Test 1: Examining store structure')
const [store, setStore] = createStore({ value: 42, nested: { count: 0 } })

// Get all symbols
const symbols = Object.getOwnPropertySymbols(store)
console.log('  Symbols on store proxy:', symbols.map(s => s.toString()))

// Try to access the $NODE symbol directly
const NODE = Symbol('store-node')
const PROXY = Symbol('store-proxy')
const TRACK = Symbol('store-track')

console.log('  store[$NODE]:', store[NODE])
console.log('  store[$PROXY]:', store[PROXY])
console.log('  store[$TRACK]:', store[TRACK])

// Check if we can access the underlying target
console.log('\nTest 2: Trying to unwrap proxy')
console.log('  Store itself:', store)
console.log('  Type:', typeof store)
console.log('  Is array?', Array.isArray(store))
console.log('  Constructor:', store.constructor.name)

// Test reading a value to trigger signal creation
console.log('\nTest 3: Triggering signal creation through read')
let effectRuns = 0
const dispose = effect(() => {
  effectRuns++
  console.log(`  Effect run #${effectRuns}, value: ${store.value}`)
})

// After first read in effect, check symbols again
const symbolsAfterRead = Object.getOwnPropertySymbols(store)
console.log('  Symbols after reactive read:', symbolsAfterRead.map(s => s.toString()))

// Now try to update
console.log('\nTest 4: Update through setStore')
console.log('  Before update: store.value =', store.value)
console.log('  Effect runs before:', effectRuns)

setStore('value', 100)

console.log('  After update: store.value =', store.value)
console.log('  Effect runs after:', effectRuns)

// Check what happens with direct assignment
console.log('\nTest 5: Direct assignment through proxy')
store.value = 200

console.log('  After direct assignment: store.value =', store.value)
console.log('  Effect runs after direct:', effectRuns)

dispose()

// Test nested access
console.log('\nTest 6: Nested object access')
const [store2, setStore2] = createStore({
  user: {
    name: 'Alice',
    settings: {
      theme: 'dark'
    }
  }
})

let nestedRuns = 0
const dispose2 = effect(() => {
  nestedRuns++
  const theme = store2.user.settings.theme
  console.log(`  Effect run #${nestedRuns}, theme: ${theme}`)
})

console.log('  Initial runs:', nestedRuns)

// Update nested
setStore2('user', 'settings', 'theme', 'light')
console.log('  After nested update:', nestedRuns)
console.log('  Theme value:', store2.user.settings.theme)

dispose2()

// Test if the issue is with how we're creating/storing nodes
console.log('\nTest 7: Manual property access pattern')
const [store3] = createStore({ x: 1, y: 2 })

// Try to trigger node creation manually by accessing in effect context
let sum = 0
let calcRuns = 0
const dispose3 = effect(() => {
  calcRuns++
  sum = store3.x + store3.y
  console.log(`  Calc run #${calcRuns}, sum: ${sum}`)
})

console.log('  Initial calc runs:', calcRuns)

// Try different update patterns
console.log('\n  Testing direct property set...')
store3.x = 10
console.log('  After store3.x = 10: runs =', calcRuns, 'sum =', sum)

console.log('\n  Testing setStore pattern...')
setStore('y', 20)
console.log('  After setStore("y", 20): runs =', calcRuns, 'sum =', sum)

dispose3()
