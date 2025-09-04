// Exact replica of DocumentStore to find the issue
import { deepSignal, watch } from 'alien-deepsignals'

console.log('=== Exact DocumentStore replica test ===')

class TestDocumentStore {
  constructor() {
    this.documents = new Map()
    this.signals = new Map()
  }

  getKey(type, id) {
    return `${type}:${id}`
  }

  setDocument(type, id, document) {
    const key = this.getKey(type, id)
    this.documents.set(key, document)

    // Always create a fresh signal to preserve alien-deepsignals reactivity
    console.log('  Creating fresh signal for document:', document)
    const deepSig = deepSignal(JSON.parse(JSON.stringify(document)))
    console.log('  Fresh signal created:', deepSig)
    console.log('  Fresh signal type:', typeof deepSig)
    this.signals.set(key, deepSig)
    console.log('  Signal stored in map')
  }

  getDocument(type, id) {
    const signal = this.getDeepSignal(type, id)
    return signal._isEmpty ? null : signal
  }

  getDeepSignal(type, id) {
    const key = this.getKey(type, id)
    console.log('  Getting deep signal for key:', key)

    if (!this.signals.has(key)) {
      console.log('  No signal exists, creating empty signal')
      const existingDocument = this.documents.get(key)

      if (existingDocument) {
        // Create signal with existing document
        const deepSig = deepSignal(JSON.parse(JSON.stringify(existingDocument)))
        this.signals.set(key, deepSig)
        return deepSig
      } else {
        // Create empty signal marked as empty
        const deepSig = deepSignal({})
        deepSig._isEmpty = true
        this.signals.set(key, deepSig)
        return deepSig
      }
    }

    const signal = this.signals.get(key)
    console.log('  Retrieved signal:', typeof signal, signal?.id || '[empty]')
    return signal
  }
}

// Test the exact sequence
console.log('\n1. Create store and document:')
const store = new TestDocumentStore()
const document = {
  id: 'user-1',
  userId: 'user-1',
  firstName: 'Test',
  lastName: 'User',
  todos: [
    { id: '1', text: 'Todo 1', completed: false },
    { id: '2', text: 'Todo 2', completed: false },
    { id: '3', text: 'Todo 3', completed: false },
  ],
  createdAt: Date.now(),
  updatedAt: Date.now(),
}

console.log('\n2. Set document in store:')
store.setDocument('userTodoList', 'user-1', document)

console.log('\n3. Get deep signal:')
const storeSignal = store.getDeepSignal('userTodoList', 'user-1')
console.log('Retrieved deep signal todos:', storeSignal.todos?.length)

console.log('\n4. Test watch on deep signal:')
try {
  let callCount = 0
  const unwatch = watch(
    storeSignal,
    value => {
      callCount++
      console.log(`Watch call ${callCount}:`)
      console.log('  value type:', typeof value)
      console.log('  value is undefined:', value === undefined)
      console.log('  value is null:', value === null)
      console.log('  storeSignal === value:', storeSignal === value)
      if (value) {
        console.log('  value.todos length:', value.todos?.length)
      }
    },
    {
      deep: true,
      immediate: true,
    }
  )

  console.log('✓ Watch setup successful')

  setTimeout(() => {
    console.log(`Final call count: ${callCount}`)
    unwatch()
  }, 100)
} catch (error) {
  console.log('✗ Watch setup failed:', error.message)
  console.log('Error details:', error.stack)
}
