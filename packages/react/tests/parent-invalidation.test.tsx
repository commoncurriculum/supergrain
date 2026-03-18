import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React from 'react'
import { createStore } from '@supergrain/core'
import { tracked } from '../src'
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
    const RootComponent = tracked(() => {
      rootRenderCount++
      // Access the root level0 property
      const _ = store.level0
      return <div data-testid="root">Root: {rootRenderCount}</div>
    })

    // Component that accesses level1
    const Level1Component = tracked(() => {
      level1RenderCount++
      const _ = store.level0.level1
      return <div data-testid="level1">Level1: {level1RenderCount}</div>
    })

    // Component that accesses level2
    const Level2Component = tracked(() => {
      level2RenderCount++
      const _ = store.level0.level1.level2
      return <div data-testid="level2">Level2: {level2RenderCount}</div>
    })

    // Component that accesses level3
    const Level3Component = tracked(() => {
      level3RenderCount++
      const _ = store.level0.level1.level2.level3
      return <div data-testid="level3">Level3: {level3RenderCount}</div>
    })

    // Component that accesses level4
    const Level4Component = tracked(() => {
      level4RenderCount++
      const _ = store.level0?.level1?.level2?.level3?.level4
      return <div data-testid="level4">Level4: {level4RenderCount}</div>
    })

    // Component that accesses array
    const ArrayComponent = tracked(() => {
      arrayRenderCount++
      const _ = store.array
      return <div data-testid="array">Array: {arrayRenderCount}</div>
    })

    // Component that accesses array item
    const ArrayItemComponent = tracked(() => {
      arrayItemRenderCount++
      const _ = store.array[0]
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

    // Test 1: Update deeply nested object property
    await act(async () => {
      update({
        $set: {
          'level0.level1.level2.level3.level4.value': 'updated-deep',
        },
      })
      await flushMicrotasks()
    })

    const rootAfterDeep = rootRenderCount
    const level1AfterDeep = level1RenderCount
    const level2AfterDeep = level2RenderCount
    const level3AfterDeep = level3RenderCount
    const level4AfterDeep = level4RenderCount

    // Test 2: Update array nested property
    await act(async () => {
      update({
        $set: {
          'array.0.nested.deep.value': 'updated-array-deep',
        },
      })
      await flushMicrotasks()
    })

    // Test 3: Update intermediate level directly
    await act(async () => {
      update({
        $set: {
          'level0.level1.level2': { newProp: 'direct-update' },
        },
      })
      await flushMicrotasks()
    })
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
    const ArrayAccessComponent = tracked(() => {
      arrayAccessRenderCount++
      const _ = store.items
      return <div>Array access: {arrayAccessRenderCount}</div>
    })

    // Component that accesses first array item
    const ItemAccessComponent = tracked(() => {
      itemAccessRenderCount++
      const _ = store.items[0]
      return <div>Item access: {itemAccessRenderCount}</div>
    })

    // Component that accesses nested property in array item
    const DetailsAccessComponent = tracked(() => {
      detailsAccessRenderCount++
      const _ = store.items[0].details
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

    // Update deeply nested property in array item
    await act(async () => {
      update({
        $set: {
          'items.0.details.meta.tag': 'UPDATED',
        },
      })
      await flushMicrotasks()
    })
  })
})
