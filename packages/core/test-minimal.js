import { signal, effect } from 'alien-signals'

console.log('Testing alien-signals directly to verify they work...\n')

// Test 1: Basic signal and effect
console.log('Test 1: Basic signal reactivity')
const sig1 = signal(42)
let effectRuns1 = 0
let lastValue1 = 0

const dispose1 = effect(() => {
  effectRuns1++
  lastValue1 = sig1()
  console.log(`  Effect run #${effectRuns1}, value: ${lastValue1}`)
})

console.log(`  Initial runs: ${effectRuns1}`)

console.log('  Setting signal to 43...')
sig1(43)
console.log(`  After update: runs = ${effectRuns1}, value = ${sig1()}`)

console.log('  Setting signal to 44...')
sig1(44)
console.log(`  After update: runs = ${effectRuns1}, value = ${sig1()}`)

dispose1()

// Test 2: Signal with equals false
console.log('\nTest 2: Signal with equals: false (if supported)')
let sig2
try {
  sig2 = signal(100, { equals: false })
  console.log('  Created signal with equals: false')
} catch (e) {
  console.log('  Error creating signal with options:', e.message)
  sig2 = signal(100)
  console.log('  Created signal without options')
}

let effectRuns2 = 0
const dispose2 = effect(() => {
  effectRuns2++
  const val = sig2()
  console.log(`  Effect run #${effectRuns2}, value: ${val}`)
})

console.log(`  Initial runs: ${effectRuns2}`)

console.log('  Setting to same value (100)...')
sig2(100)
console.log(`  After setting same value: runs = ${effectRuns2}`)

console.log('  Setting to different value (200)...')
sig2(200)
console.log(`  After setting different value: runs = ${effectRuns2}`)

dispose2()

// Test 3: Multiple signals in one effect
console.log('\nTest 3: Multiple signals tracked')
const sigA = signal(1)
const sigB = signal(2)
const sigC = signal(3)

let effectRuns3 = 0
let lastSum = 0

const dispose3 = effect(() => {
  effectRuns3++
  lastSum = sigA() + sigB() + sigC()
  console.log(`  Effect run #${effectRuns3}, sum: ${lastSum}`)
})

console.log(`  Initial runs: ${effectRuns3}`)

console.log('  Updating sigA to 10...')
sigA(10)
console.log(`  After sigA update: runs = ${effectRuns3}`)

console.log('  Updating sigB to 20...')
sigB(20)
console.log(`  After sigB update: runs = ${effectRuns3}`)

console.log('  Updating sigC to 30...')
sigC(30)
console.log(`  After sigC update: runs = ${effectRuns3}`)

dispose3()

// Test 4: Verify signal() returns a function that can both get and set
console.log('\nTest 4: Signal function signature')
const sig4 = signal(42)
console.log('  Type of signal:', typeof sig4)
console.log('  Signal is function?', typeof sig4 === 'function')
console.log('  Can read: sig4() =', sig4())
console.log('  Can write: sig4(100)')
sig4(100)
console.log('  After write: sig4() =', sig4())

// Test 5: Store writer pattern (Solid.js compatibility)
console.log('\nTest 5: Store writer on reader pattern')
const sig5 = signal(42)
sig5.$ = (v) => sig5(v)  // Add writer as property

let effectRuns5 = 0
const dispose5 = effect(() => {
  effectRuns5++
  const val = sig5()
  console.log(`  Effect run #${effectRuns5}, value: ${val}`)
})

console.log('  Using normal setter: sig5(50)')
sig5(50)
console.log(`  After normal set: runs = ${effectRuns5}`)

console.log('  Using $ writer: sig5.$(60)')
sig5.$(60)
console.log(`  After $ set: runs = ${effectRuns5}`)

dispose5()

console.log('\nAll tests completed!')
