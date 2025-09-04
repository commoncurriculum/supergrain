// Test what makes a signal invalid for watching
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing signal validity...')

// Test 1: Fresh signal
const signal1 = deepSignal({ count: 0, todos: [] })
console.log('1. Fresh signal created')

try {
  const unwatch1 = watch(signal1, () => {}, { deep: true })
  console.log('   ✓ Fresh signal is watchable')
  unwatch1()
} catch (e) {
  console.log('   ✗ Fresh signal is not watchable:', e.message)
}

// Test 2: Signal after property deletion
const signal2 = deepSignal({ count: 0, todos: [] })
delete signal2.count
console.log('2. Signal after property deletion')

try {
  const unwatch2 = watch(signal2, () => {}, { deep: true })
  console.log('   ✓ Signal after deletion is watchable')
  unwatch2()
} catch (e) {
  console.log('   ✗ Signal after deletion is not watchable:', e.message)
}

// Test 3: Signal after Object.assign
const signal3 = deepSignal({})
Object.assign(signal3, { count: 0, todos: [] })
console.log('3. Signal after Object.assign')

try {
  const unwatch3 = watch(signal3, () => {}, { deep: true })
  console.log('   ✓ Signal after Object.assign is watchable')
  unwatch3()
} catch (e) {
  console.log('   ✗ Signal after Object.assign is not watchable:', e.message)
}

// Test 4: Signal after property assignment
const signal4 = deepSignal({})
signal4.count = 0
signal4.todos = []
console.log('4. Signal after property assignment')

try {
  const unwatch4 = watch(signal4, () => {}, { deep: true })
  console.log('   ✓ Signal after assignment is watchable')
  unwatch4()
} catch (e) {
  console.log('   ✗ Signal after assignment is not watchable:', e.message)
}

// Test 5: Signal after clearing and reassigning (like our DocumentStore does)
const signal5 = deepSignal({ old: 'data' })
Object.keys(signal5).forEach(k => delete signal5[k])
signal5.count = 0
signal5.todos = []
console.log('5. Signal after clearing and reassigning')

try {
  const unwatch5 = watch(signal5, () => {}, { deep: true })
  console.log('   ✓ Signal after clear+assign is watchable')
  unwatch5()
} catch (e) {
  console.log('   ✗ Signal after clear+assign is not watchable:', e.message)
}
