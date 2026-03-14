import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { memo } from 'react'
import { createStore } from '@supergrain/core'
import { useTracked } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Parent Invalidation Depth Tests', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should test how many levels of parent invalidation occur', async () => {
    // Create deeply nested structure
    const [store, update] = createStore({
      level0: {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'initial',
              },
            },
          },
        },
      },
      array: [
        {
          id: 1,
          nested: {
            deep: {
              value: 'array-initial',
            },
          },
        },
      ],
    })

    // Track render counts for components at each level
    let rootRenderCount = 0
    let level1RenderCount = 0
    let level2RenderCount = 0
    let level3RenderCount = 0
    let level4RenderCount = 0
    let arrayRenderCount = 0
    let arrayItemRenderCount = 0

    // Component that accesses root level
    const RootComponent = memo(() => {
      rootRenderCount++
      const state = useTracked(store)
      // Access the root level0 property
      const _ = state.level0
      return <div data-testid="root">Root: {rootRenderCount}</div>
    })

    // Component that accesses level1
    const Level1Component = memo(() => {
      level1RenderCount++
      const state = useTracked(store)
      // Access level1 property
      const _ = state.level0.level1
      return <div data-testid="level1">Level1: {level1RenderCount}</div>
    })

    // Component that accesses level2
    const Level2Component = memo(() => {
      level2RenderCount++
      const state = useTracked(store)
      // Access level2 property
      const _ = state.level0.level1.level2
      return <div data-testid="level2">Level2: {level2RenderCount}</div>
    })

    // Component that accesses level3
    const Level3Component = memo(() => {
      level3RenderCount++
      const state = useTracked(store)
      // Access level3 property
      const _ = state.level0.level1.level2.level3
      return <div data-testid="level3">Level3: {level3RenderCount}</div>
    })

    // Component that accesses level4
    const Level4Component = memo(() => {
      level4RenderCount++
      const state = useTracked(store)
      // Access level4 property - defensive access since structure may be replaced
      const _ = state.level0?.level1?.level2?.level3?.level4
      return <div data-testid="level4">Level4: {level4RenderCount}</div>
    })

    // Component that accesses array
    const ArrayComponent = memo(() => {
      arrayRenderCount++
      const state = useTracked(store)
      // Access the array itself
      const _ = state.array
      return <div data-testid="array">Array: {arrayRenderCount}</div>
    })

    // Component that accesses array item
    const ArrayItemComponent = memo(() => {
      arrayItemRenderCount++
      const state = useTracked(store)
      // Access the array item
      const _ = state.array[0]
      return (
        <div data-testid="array-item">ArrayItem: {arrayItemRenderCount}</div>
      )
    })

    function TestApp() {
      return (
        <div>
          <RootComponent />
          <Level1Component />
          <Level2Component />
          <Level3Component />
          <Level4Component />
          <ArrayComponent />
          <ArrayItemComponent />
        </div>
      )
    }

    render(<TestApp />)

    // Initial render - all components render once
    expect(rootRenderCount).toBe(1)
    expect(level1RenderCount).toBe(1)
    expect(level2RenderCount).toBe(1)
    expect(level3RenderCount).toBe(1)
    expect(level4RenderCount).toBe(1)
    expect(arrayRenderCount).toBe(1)
    expect(arrayItemRenderCount).toBe(1)

    console.log('=== Initial render counts ===')
    console.log('Root:', rootRenderCount)
    console.log('Level1:', level1RenderCount)
    console.log('Level2:', level2RenderCount)
    console.log('Level3:', level3RenderCount)
    console.log('Level4:', level4RenderCount)
    console.log('Array:', arrayRenderCount)
    console.log('ArrayItem:', arrayItemRenderCount)

    // Test 1: Update deeply nested object property
    await act(async () => {
      console.log(
        '\n=== Test 1: Updating level0.level1.level2.level3.level4.value ==='
      )
      update({
        $set: {
          'level0.level1.level2.level3.level4.value': 'updated-deep',
        },
      })
      await flushMicrotasks()
    })

    console.log('After deep nested update:')
    console.log('Root:', rootRenderCount)
    console.log('Level1:', level1RenderCount)
    console.log('Level2:', level2RenderCount)
    console.log('Level3:', level3RenderCount)
    console.log('Level4:', level4RenderCount)
    console.log('Array:', arrayRenderCount)
    console.log('ArrayItem:', arrayItemRenderCount)

    const rootAfterDeep = rootRenderCount
    const level1AfterDeep = level1RenderCount
    const level2AfterDeep = level2RenderCount
    const level3AfterDeep = level3RenderCount
    const level4AfterDeep = level4RenderCount

    // Test 2: Update array nested property
    await act(async () => {
      console.log('\n=== Test 2: Updating array.0.nested.deep.value ===')
      update({
        $set: {
          'array.0.nested.deep.value': 'updated-array-deep',
        },
      })
      await flushMicrotasks()
    })

    console.log('After array nested update:')
    console.log('Root:', rootRenderCount)
    console.log('Level1:', level1RenderCount)
    console.log('Level2:', level2RenderCount)
    console.log('Level3:', level3RenderCount)
    console.log('Level4:', level4RenderCount)
    console.log('Array:', arrayRenderCount)
    console.log('ArrayItem:', arrayItemRenderCount)

    // Test 3: Update intermediate level directly
    await act(async () => {
      console.log('\n=== Test 3: Updating level0.level1.level2 directly ===')
      update({
        $set: {
          'level0.level1.level2': { newProp: 'direct-update' },
        },
      })
      await flushMicrotasks()
    })

    console.log('After direct intermediate update:')
    console.log('Root:', rootRenderCount)
    console.log('Level1:', level1RenderCount)
    console.log('Level2:', level2RenderCount)
    console.log('Level3:', level3RenderCount)
    console.log('Level4:', level4RenderCount)
    console.log('Array:', arrayRenderCount)
    console.log('ArrayItem:', arrayItemRenderCount)

    // Analyze results
    console.log('\n=== Analysis ===')
    console.log('Deep nested update caused re-renders in:')
    if (rootAfterDeep > 1) console.log('- Root component (accesses level0)')
    if (level1AfterDeep > 1) console.log('- Level1 component (accesses level1)')
    if (level2AfterDeep > 1) console.log('- Level2 component (accesses level2)')
    if (level3AfterDeep > 1) console.log('- Level3 component (accesses level3)')
    if (level4AfterDeep > 1) console.log('- Level4 component (accesses level4)')

    // Document findings in test assertions
    // These will help us understand the actual behavior
    console.log(
      `\nParent invalidation depth: ${
        rootAfterDeep > 1
          ? '5+ levels'
          : level1AfterDeep > 1
          ? '4 levels'
          : level2AfterDeep > 1
          ? '3 levels'
          : level3AfterDeep > 1
          ? '2 levels'
          : level4AfterDeep > 1
          ? '1 level'
          : '0 levels (no parent invalidation)'
      }`
    )
  })

  it('should test array-specific parent invalidation behavior', async () => {
    const [store, update] = createStore({
      items: [
        {
          id: 1,
          name: 'Item 1',
          details: { description: 'First item', meta: { tag: 'A' } },
        },
        {
          id: 2,
          name: 'Item 2',
          details: { description: 'Second item', meta: { tag: 'B' } },
        },
      ],
    })

    let arrayAccessRenderCount = 0
    let itemAccessRenderCount = 0
    let detailsAccessRenderCount = 0

    // Component that accesses the array
    const ArrayAccessComponent = memo(() => {
      arrayAccessRenderCount++
      const state = useTracked(store)
      // Access the items array
      const _ = state.items
      return <div>Array access: {arrayAccessRenderCount}</div>
    })

    // Component that accesses first array item
    const ItemAccessComponent = memo(() => {
      itemAccessRenderCount++
      const state = useTracked(store)
      // Access the first item
      const _ = state.items[0]
      return <div>Item access: {itemAccessRenderCount}</div>
    })

    // Component that accesses nested property in array item
    const DetailsAccessComponent = memo(() => {
      detailsAccessRenderCount++
      const state = useTracked(store)
      // Access nested details
      const _ = state.items[0].details
      return <div>Details access: {detailsAccessRenderCount}</div>
    })

    function ArrayTestApp() {
      return (
        <div>
          <ArrayAccessComponent />
          <ItemAccessComponent />
          <DetailsAccessComponent />
        </div>
      )
    }

    render(<ArrayTestApp />)

    // Initial render
    expect(arrayAccessRenderCount).toBe(1)
    expect(itemAccessRenderCount).toBe(1)
    expect(detailsAccessRenderCount).toBe(1)

    console.log('\n=== Array Test: Initial render ===')
    console.log('Array access:', arrayAccessRenderCount)
    console.log('Item access:', itemAccessRenderCount)
    console.log('Details access:', detailsAccessRenderCount)

    // Update deeply nested property in array item
    await act(async () => {
      console.log('\n=== Updating items.0.details.meta.tag ===')
      update({
        $set: {
          'items.0.details.meta.tag': 'UPDATED',
        },
      })
      await flushMicrotasks()
    })

    console.log('After deep array update:')
    console.log('Array access:', arrayAccessRenderCount)
    console.log('Item access:', itemAccessRenderCount)
    console.log('Details access:', detailsAccessRenderCount)

    // Analyze array invalidation behavior
    console.log('\n=== Array Invalidation Analysis ===')
    if (arrayAccessRenderCount > 1) {
      console.log(
        '✓ Array component re-rendered - parent invalidation works for arrays'
      )
    } else {
      console.log(
        '✗ Array component did NOT re-render - no parent invalidation for arrays'
      )
    }

    if (itemAccessRenderCount > 1) {
      console.log(
        '✓ Item component re-rendered - item-level invalidation works'
      )
    } else {
      console.log(
        '✗ Item component did NOT re-render - no item-level invalidation'
      )
    }

    if (detailsAccessRenderCount > 1) {
      console.log(
        '✓ Details component re-rendered - nested property invalidation works'
      )
    } else {
      console.log(
        '✗ Details component did NOT re-render - no nested property invalidation'
      )
    }
  })
})
