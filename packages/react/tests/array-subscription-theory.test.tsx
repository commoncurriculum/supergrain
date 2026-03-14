import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { memo } from 'react'
import { createStore } from '@supergrain/core'
import { useTracked } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Array Subscription Theory Tests', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should test if accessing array elements creates subscriptions to those elements', async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: 'Item 1' },
        { id: 2, label: 'Item 2' },
      ],
    })

    let arrayOnlyRenderCount = 0
    let elementAccessRenderCount = 0
    let specificElementRenderCount = 0

    // Component that only accesses the array, not elements
    const ArrayOnlyComponent = memo(() => {
      arrayOnlyRenderCount++
      const state = useTracked(store)
      // Only access array length, not individual elements
      console.log(`ArrayOnly: accessed array length: ${state.data.length}`)
      return <div>Array length: {state.data.length}</div>
    })

    // Component that accesses all elements during iteration
    const ElementAccessComponent = memo(() => {
      elementAccessRenderCount++
      const state = useTracked(store)
      // Access each element (this should create subscriptions to data[0], data[1], etc.)
      const elementCount = state.data.map(item => item.id).length
      console.log(`ElementAccess: accessed ${elementCount} elements`)
      return <div>Element count: {elementCount}</div>
    })

    // Component that accesses only a specific element
    const SpecificElementComponent = memo(() => {
      specificElementRenderCount++
      const state = useTracked(store)
      // Access only data[0]
      const firstItem = state.data[0]
      console.log(`SpecificElement: accessed data[0].id = ${firstItem?.id}`)
      return <div>First item: {firstItem?.id}</div>
    })

    function TestApp() {
      return (
        <div>
          <ArrayOnlyComponent />
          <ElementAccessComponent />
          <SpecificElementComponent />
        </div>
      )
    }

    render(<TestApp />)

    console.log('\n=== Initial render ===')
    console.log('ArrayOnly renders:', arrayOnlyRenderCount)
    console.log('ElementAccess renders:', elementAccessRenderCount)
    console.log('SpecificElement renders:', specificElementRenderCount)

    // Test: Update data.0.label
    await act(async () => {
      console.log('\n=== Updating data.0.label ===')
      update({ $set: { 'data.0.label': 'Updated Item 1' } })
      await flushMicrotasks()
    })

    console.log('\nAfter updating data.0.label:')
    console.log('ArrayOnly renders:', arrayOnlyRenderCount)
    console.log('ElementAccess renders:', elementAccessRenderCount)
    console.log('SpecificElement renders:', specificElementRenderCount)

    // Test: Update data.1.label (to see if it's element-specific)
    await act(async () => {
      console.log('\n=== Updating data.1.label ===')
      update({ $set: { 'data.1.label': 'Updated Item 2' } })
      await flushMicrotasks()
    })

    console.log('\nAfter updating data.1.label:')
    console.log('ArrayOnly renders:', arrayOnlyRenderCount)
    console.log('ElementAccess renders:', elementAccessRenderCount)
    console.log('SpecificElement renders:', specificElementRenderCount)

    // Analysis
    console.log('\n=== Theory Verification ===')
    console.log(
      `ArrayOnly re-rendered on element changes: ${
        arrayOnlyRenderCount > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(
      `ElementAccess re-rendered on element changes: ${
        elementAccessRenderCount > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(
      `SpecificElement re-rendered on data[0] changes: ${
        specificElementRenderCount > 1 ? 'YES' : 'NO'
      }`
    )

    if (arrayOnlyRenderCount === 1 && elementAccessRenderCount > 1) {
      console.log(
        '✓ THEORY CONFIRMED: Accessing array elements creates element subscriptions'
      )
    } else if (arrayOnlyRenderCount > 1) {
      console.log(
        '✗ THEORY REJECTED: Array structure itself is subscribed to element changes'
      )
    } else {
      console.log('? UNEXPECTED: No re-renders occurred')
    }
  })
})
