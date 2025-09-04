// Test React hooks directly
import { DocumentStore } from '../../src/core/store/DocumentStore.ts'
import { useDocument } from '../../src/react/index.ts'
import React from 'react'
import { render } from '@testing-library/react'

console.log('=== Testing React hooks directly ===')

const store = new DocumentStore()

// Set up test data
const testDocument = {
  id: 'test-1',
  name: 'Test Document',
  todos: [
    { id: '1', text: 'Test todo', completed: false }
  ]
}

store.setDocument('test', 'test-1', testDocument)
console.log('✓ Test document set in store')

// Test component using the hook
let renderCount = 0
let latestValue = null

function TestComponent() {
  renderCount++
  latestValue = useDocument(store, 'test', 'test-1')
  console.log(`Component render #${renderCount}:`, latestValue ? 'document loaded' : 'loading')
  return React.createElement('div', null, latestValue?.name || 'Loading...')
}

console.log('Rendering test component...')
try {
  const { rerender } = render(React.createElement(TestComponent))

  console.log(`Initial render complete. Renders: ${renderCount}`)
  console.log('Latest value:', latestValue?.name)

  // Test rerender
  setTimeout(() => {
    console.log('Triggering rerender...')
    rerender(React.createElement(TestComponent))

    setTimeout(() => {
      console.log(`Final state - Renders: ${renderCount}`)
      console.log('Final value:', latestValue?.name)

      if (renderCount >= 1 && latestValue?.name === 'Test Document') {
        console.log('🎉 SUCCESS: React hook is working correctly!')
      } else {
        console.log('❌ FAILED: React hook not working properly')
      }
    }, 100)
  }, 100)

} catch (error) {
  console.log('❌ Error rendering component:', error.message)
  console.log(error.stack)
}
