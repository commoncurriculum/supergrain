// Test what happens when we modify a signal like DocumentStore does
import { deepSignal, watch } from 'alien-deepsignals'

console.log('Testing signal modification...')

// Create empty signal like DocumentStore does for non-existent docs
const signal = deepSignal({})
signal._isEmpty = true

console.log('1. Created empty signal with _isEmpty:', signal._isEmpty)

// Test if empty signal is watchable
try {
  const unwatch1 = watch(signal, () => {}, { deep: true })
  console.log('   ✓ Empty signal is watchable')
  unwatch1()
} catch (e) {
  console.log('   ✗ Empty signal not watchable:', e.message)
}

console.log('\n2. Modifying signal like DocumentStore.setDocument does...')

// Simulate what our setDocument does
const document = {
  id: 'test',
  todos: [{ id: '1', text: 'Test', completed: false }]
}

// Clear existing properties (except alien-signals internals)
Object.keys(signal).forEach(k => {
  if (k !== '_isEmpty' && !k.startsWith('__')) {
    delete signal[k]
  }
})

// Set new properties directly (like our fixed setDocument)
Object.keys(document).forEach(key => {
  signal[key] = document[key]
})

delete signal._isEmpty

console.log('   Modified signal:', signal)

// Now try to watch the modified signal
try {
  let watchCount = 0
  const unwatch2 = watch(signal, (value) => {
    watchCount++
    console.log(`   Watch ${watchCount}: received`, typeof value, value?.id)
  }, { deep: true, immediate: true })

  console.log('   ✓ Modified signal is watchable')

  // Test mutation
  setTimeout(() => {
    console.log('\n3. Testing mutation on modified signal...')
    signal.todos.push({ id: '2', text: 'Added', completed: false })
  }, 100)

  setTimeout(() => {
    console.log(`   Final watch count: ${watchCount}`)
    if (watchCount >= 2) {
      console.log('   ✓ Mutations triggered watch')
    } else {
      console.log('   ✗ Mutations did not trigger watch')
    }
    unwatch2()
  }, 200)

} catch (e) {
  console.log('   ✗ Modified signal not watchable:', e.message)
}
