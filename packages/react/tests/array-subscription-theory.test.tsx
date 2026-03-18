import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React from 'react'
import { createStore } from '@supergrain/core'
import { tracked } from '../src'
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
    const ArrayOnlyComponent = tracked(() => {
      arrayOnlyRenderCount++
      // Only access array length, not individual elements
      return <div>Array length: {store.data.length}</div>
    })

    // Component that accesses all elements during iteration
    const ElementAccessComponent = tracked(() => {
      elementAccessRenderCount++
      // Access each element (this should create subscriptions to data[0], data[1], etc.)
      const elementCount = store.data.map(item => item.id).length
      return <div>Element count: {elementCount}</div>
    })

    // Component that accesses only a specific element
    const SpecificElementComponent = tracked(() => {
      specificElementRenderCount++
      // Access only data[0]
      const firstItem = store.data[0]
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

    // Test: Update data.0.label
    await act(async () => {
      update({ $set: { 'data.0.label': 'Updated Item 1' } })
      await flushMicrotasks()
    })

    // Test: Update data.1.label (to see if it's element-specific)
    await act(async () => {
      update({ $set: { 'data.1.label': 'Updated Item 2' } })
      await flushMicrotasks()
    })
  })
})
