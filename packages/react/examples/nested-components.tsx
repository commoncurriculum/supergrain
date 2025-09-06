import React from 'react'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'

// Create a store with separate properties for different component levels
const [store, update] = createStore({
  grandparent: {
    value: 1,
    label: 'Grandparent',
  },
  parent: {
    value: 10,
    label: 'Parent',
  },
  child: {
    value: 100,
    label: 'Child',
  },
  shared: {
    theme: 'light',
    fontSize: 14,
  },
})

// Track render counts for demonstration
let grandparentRenders = 0
let parentRenders = 0
let childRenders = 0

// Child component - only tracks child.value
function Child() {
  const state = useTrackedStore(store)
  childRenders++

  return (
    <div
      style={{
        padding: '10px',
        margin: '10px',
        border: '1px solid blue',
        borderRadius: '4px',
      }}
    >
      <h3>Child Component</h3>
      <p>Value: {state.child.value}</p>
      <p>Render count: {childRenders}</p>
      <button
        onClick={() =>
          update({ $set: { 'child.value': state.child.value + 1 } })
        }
      >
        Increment Child
      </button>
    </div>
  )
}

// Parent component - tracks parent.value and renders Child
function Parent() {
  const state = useTrackedStore(store)
  parentRenders++

  return (
    <div
      style={{
        padding: '10px',
        margin: '10px',
        border: '1px solid green',
        borderRadius: '4px',
      }}
    >
      <h2>Parent Component</h2>
      <p>Value: {state.parent.value}</p>
      <p>Render count: {parentRenders}</p>
      <button
        onClick={() =>
          update({ $set: { 'parent.value': state.parent.value + 10 } })
        }
      >
        Increment Parent
      </button>
      <Child />
    </div>
  )
}

// Grandparent component - tracks grandparent.value and renders Parent
function GrandParent() {
  const state = useTrackedStore(store)
  grandparentRenders++

  return (
    <div
      style={{
        padding: '10px',
        margin: '10px',
        border: '1px solid red',
        borderRadius: '4px',
      }}
    >
      <h1>Grandparent Component</h1>
      <p>Value: {state.grandparent.value}</p>
      <p>Render count: {grandparentRenders}</p>
      <p>Theme: {state.shared.theme}</p>
      <button
        onClick={() =>
          update({
            $set: { 'grandparent.value': state.grandparent.value + 100 },
          })
        }
      >
        Increment Grandparent
      </button>
      <button
        onClick={() => {
          const newTheme = state.shared.theme === 'light' ? 'dark' : 'light'
          update({ $set: { 'shared.theme': newTheme } })
        }}
      >
        Toggle Theme (affects only Grandparent)
      </button>
      <Parent />
    </div>
  )
}

// Sibling components example - demonstrating independent tracking
function SiblingA() {
  const state = useTrackedStore(store)
  return (
    <div
      style={{
        padding: '10px',
        border: '1px solid purple',
        borderRadius: '4px',
      }}
    >
      <h3>Sibling A</h3>
      <p>Parent Value: {state.parent.value}</p>
    </div>
  )
}

function SiblingB() {
  const state = useTrackedStore(store)
  return (
    <div
      style={{
        padding: '10px',
        border: '1px solid orange',
        borderRadius: '4px',
      }}
    >
      <h3>Sibling B</h3>
      <p>Child Value: {state.child.value}</p>
    </div>
  )
}

function SiblingContainer() {
  return (
    <div
      style={{
        display: 'flex',
        gap: '10px',
        margin: '10px',
        padding: '10px',
        border: '1px solid gray',
        borderRadius: '4px',
      }}
    >
      <SiblingA />
      <SiblingB />
    </div>
  )
}

// Main App component
export function NestedComponentsExample() {
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px' }}>
      <h1>Nested Components with Isolated Tracking</h1>

      <div
        style={{
          marginBottom: '20px',
          padding: '10px',
          background: '#f0f0f0',
          borderRadius: '4px',
        }}
      >
        <h3>Instructions:</h3>
        <ul>
          <li>Click buttons to update different properties</li>
          <li>
            Notice that only components tracking the changed property re-render
          </li>
          <li>Child updates don't cause parent re-renders</li>
          <li>
            Parent updates cause child re-renders (due to React's component
            tree)
          </li>
          <li>
            Theme toggle only affects Grandparent (the only component accessing
            it)
          </li>
        </ul>
      </div>

      <GrandParent />

      <h2>Sibling Components (Independent Tracking)</h2>
      <SiblingContainer />

      <div
        style={{
          marginTop: '20px',
          padding: '10px',
          background: '#e0e0e0',
          borderRadius: '4px',
        }}
      >
        <h3>Global Actions:</h3>
        <button
          onClick={() => {
            // Reset all values
            update({
              $set: {
                'grandparent.value': 1,
                'parent.value': 10,
                'child.value': 100,
                'shared.theme': 'light',
              },
            })
            grandparentRenders = 0
            parentRenders = 0
            childRenders = 0
          }}
        >
          Reset All Values and Counters
        </button>
      </div>
    </div>
  )
}

// Export a standalone app for testing
export default function App() {
  return <NestedComponentsExample />
}
