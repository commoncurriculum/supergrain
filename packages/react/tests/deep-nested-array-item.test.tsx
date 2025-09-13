import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { memo } from 'react'
import { createStore } from '@storable/core'
import { useTrackedStore, For } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Deep Nested Array Item Tests', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should test updating deeply nested property in array item - items[0].obj.objTwo.objThree', async () => {
    // Create store with exact structure you specified
    const [store, update] = createStore({
      items: [
        {
          id: 1,
          obj: {
            objTwo: {
              objThree: 1,
            },
          },
        },
      ],
    })

    let componentRenderCount = 0

    // Single component that accesses the deeply nested structure
    const DeepNestedComponent = memo(() => {
      componentRenderCount++
      const state = useTrackedStore(store)

      console.log(`DeepNestedComponent: render #${componentRenderCount}`)

      // Access the deeply nested value
      const deepValue = state.items[0].obj.objTwo.objThree
      console.log(`  Accessing items[0].obj.objTwo.objThree = ${deepValue}`)

      return <div data-testid="deep-nested-value">Deep value: {deepValue}</div>
    })

    const { container } = render(<DeepNestedComponent />)

    // Verify initial render
    expect(componentRenderCount).toBe(1)
    expect(
      container.querySelector('[data-testid="deep-nested-value"]')?.textContent
    ).toBe('Deep value: 1')

    console.log('\n=== Initial State ===')
    console.log('Component renders:', componentRenderCount)
    console.log(
      'Initial value:',
      container.querySelector('[data-testid="deep-nested-value"]')?.textContent
    )

    // Test 1: Update the deeply nested objThree value
    await act(async () => {
      console.log(
        '\n=== Test 1: Updating items.0.obj.objTwo.objThree to 42 ==='
      )
      update({
        $set: {
          'items.0.obj.objTwo.objThree': 42,
        },
      })
      await flushMicrotasks()
    })

    console.log('\nAfter objThree update:')
    console.log('Component renders:', componentRenderCount)
    console.log(
      'Updated value:',
      container.querySelector('[data-testid="deep-nested-value"]')?.textContent
    )

    const rendersAfterDeepUpdate = componentRenderCount

    // Test 2: Update a different deep property to test specificity
    await act(async () => {
      console.log(
        '\n=== Test 2: Adding new property items.0.obj.objTwo.newProp ==='
      )
      update({
        $set: {
          'items.0.obj.objTwo.newProp': 'hello',
        },
      })
      await flushMicrotasks()
    })

    console.log('\nAfter adding new property:')
    console.log('Component renders:', componentRenderCount)

    // Test 3: Update a completely different part of the structure
    await act(async () => {
      console.log('\n=== Test 3: Adding new property items.0.differentProp ===')
      update({
        $set: {
          'items.0.differentProp': 'unrelated',
        },
      })
      await flushMicrotasks()
    })

    console.log('\nAfter adding unrelated property:')
    console.log('Component renders:', componentRenderCount)

    // Analysis
    console.log('\n=== Analysis ===')
    console.log(
      `Deep nested update (objThree: 1 -> 42) caused re-render: ${
        rendersAfterDeepUpdate > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(`Component accessed items[0].obj.objTwo.objThree directly`)

    if (rendersAfterDeepUpdate > 1) {
      console.log(
        '✓ EXPECTED: Component re-rendered because it accesses the changed property'
      )
      // Verify the value actually updated in the UI
      expect(
        container.querySelector('[data-testid="deep-nested-value"]')
          ?.textContent
      ).toBe('Deep value: 42')
    } else {
      console.log(
        '✗ UNEXPECTED: Component did not re-render despite accessing the changed property'
      )
      console.log('This would indicate a bug in the reactive system')
    }

    console.log(`Total renders: ${componentRenderCount} (initial + updates)`)
  })

  it('should test array iteration with deep nested properties', async () => {
    const [store, update] = createStore({
      items: [
        {
          id: 1,
          obj: { objTwo: { objThree: 'A' } },
        },
        {
          id: 2,
          obj: { objTwo: { objThree: 'B' } },
        },
      ],
    })

    let componentRenderCount = 0

    const ArrayIterationComponent = memo(() => {
      componentRenderCount++
      const state = useTrackedStore(store)

      console.log(`ArrayIterationComponent: render #${componentRenderCount}`)

      return (
        <div>
          {state.items.map(item => (
            <div key={item.id} data-testid={`item-${item.id}`}>
              Item {item.id}: {item.obj.objTwo.objThree}
            </div>
          ))}
        </div>
      )
    })

    const { container } = render(<ArrayIterationComponent />)

    console.log('\n=== Array Iteration Test ===')
    console.log('Initial renders:', componentRenderCount)

    // Update deeply nested property in first item
    await act(async () => {
      console.log('\n=== Updating items.0.obj.objTwo.objThree ===')
      update({
        $set: {
          'items.0.obj.objTwo.objThree': 'A-UPDATED',
        },
      })
      await flushMicrotasks()
    })

    console.log('After deep update in first item:')
    console.log('Component renders:', componentRenderCount)

    // Check if the UI actually updated
    const firstItem = container.querySelector('[data-testid="item-1"]')
    console.log('First item content:', firstItem?.textContent)

    if (componentRenderCount > 1) {
      console.log(
        '✓ Array iteration component re-rendered when deep property changed'
      )
      expect(firstItem?.textContent).toBe('Item 1: A-UPDATED')
    } else {
      console.log(
        '✗ Array iteration component did NOT re-render when deep property changed'
      )
    }
  })

  it('should test with For component and deep nesting', async () => {
    const [store, update] = createStore({
      items: [
        {
          id: 1,
          obj: { objTwo: { objThree: 100 } },
        },
      ],
    })

    let componentRenderCount = 0

    const ForComponent = memo(() => {
      componentRenderCount++
      const state = useTrackedStore(store)

      console.log(`ForComponent: render #${componentRenderCount}`)

      return (
        <div>
          <For each={state.items}>
            {(item: any) => (
              <div key={item.id} data-testid={`for-item-${item.id}`}>
                For Item {item.id}: {item.obj.objTwo.objThree}
              </div>
            )}
          </For>
        </div>
      )
    })

    const { container } = render(<ForComponent />)

    console.log('\n=== For Component Deep Nesting Test ===')
    console.log('Initial renders:', componentRenderCount)

    await act(async () => {
      console.log(
        '\n=== Updating items.0.obj.objTwo.objThree with For component ==='
      )
      update({
        $set: {
          'items.0.obj.objTwo.objThree': 200,
        },
      })
      await flushMicrotasks()
    })

    console.log('After deep update with For:')
    console.log('Component renders:', componentRenderCount)

    const forItem = container.querySelector('[data-testid="for-item-1"]')
    console.log('For item content:', forItem?.textContent)

    if (componentRenderCount > 1) {
      console.log(
        '✓ For component re-rendered when deep nested property changed'
      )
      expect(forItem?.textContent).toBe('For Item 1: 200')
    } else {
      console.log(
        '✗ For component did NOT re-render when deep nested property changed'
      )
    }
  })
})
