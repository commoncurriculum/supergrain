import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { memo, useCallback } from 'react'
import { createStore } from '@supergrain/core'
import { useTracked, For } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('JS-Krauset Simple Case Tests', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should test the exact js-krauset pattern - items[0].label update', async () => {
    // Create store exactly like js-krauset
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: 'Item 1' },
        { id: 2, label: 'Item 2' },
        { id: 3, label: 'Item 3' },
      ],
      selected: null as number | null,
    })

    let parentRenderCount = 0
    let row1RenderCount = 0
    let row2RenderCount = 0
    let row3RenderCount = 0

    // Row component exactly like js-krauset
    const Row = memo(
      ({
        item,
        isSelected,
        onSelect,
      }: {
        item: any
        isSelected: boolean
        onSelect: (id: number) => void
      }) => {
        if (item.id === 1) row1RenderCount++
        if (item.id === 2) row2RenderCount++
        if (item.id === 3) row3RenderCount++

        console.log(
          `Row ${item.id} rendered - label: "${item.label}" (render #${
            item.id === 1
              ? row1RenderCount
              : item.id === 2
              ? row2RenderCount
              : row3RenderCount
          })`
        )

        return (
          <div data-testid={`row-${item.id}`}>
            <span onClick={() => onSelect(item.id)}>{item.label}</span>
          </div>
        )
      }
    )

    // Parent component exactly like js-krauset RowList
    const RowList = memo(() => {
      parentRenderCount++
      console.log(`RowList rendered (render #${parentRenderCount})`)

      const state = useTracked(store)

      const handleSelect = useCallback((id: number) => {
        updateStore({ $set: { selected: id } })
      }, [])

      console.log(`RowList accessing state.data (length: ${state.data.length})`)

      return (
        <div data-testid="row-list">
          <For each={state.data}>
            {(item: any) => (
              <Row
                key={item.id}
                item={item}
                isSelected={state.selected === item.id}
                onSelect={handleSelect}
              />
            )}
          </For>
        </div>
      )
    })

    render(<RowList />)

    // Initial render
    expect(parentRenderCount).toBe(1)
    expect(row1RenderCount).toBe(1)
    expect(row2RenderCount).toBe(1)
    expect(row3RenderCount).toBe(1)

    console.log('\n=== Initial render ===')
    console.log('Parent renders:', parentRenderCount)
    console.log('Row1 renders:', row1RenderCount)
    console.log('Row2 renders:', row2RenderCount)
    console.log('Row3 renders:', row3RenderCount)

    // Test 1: Update item label exactly like js-krauset
    await act(async () => {
      console.log('\n=== Test 1: Updating data.0.label (like js-krauset) ===')

      // This is exactly what js-krauset does in the update() function
      const updates: Record<string, string> = {}
      updates['data.0.label'] = store.data[0].label + ' !!!'

      console.log('About to update:', updates)
      updateStore({ $set: updates })
      await flushMicrotasks()
    })

    console.log('\nAfter label update:')
    console.log('Parent renders:', parentRenderCount)
    console.log('Row1 renders:', row1RenderCount)
    console.log('Row2 renders:', row2RenderCount)
    console.log('Row3 renders:', row3RenderCount)

    const parentAfterLabelUpdate = parentRenderCount
    const row1AfterLabelUpdate = row1RenderCount

    // Test 2: Update selection (this should definitely trigger re-renders)
    await act(async () => {
      console.log('\n=== Test 2: Updating selection ===')
      updateStore({ $set: { selected: 1 } })
      await flushMicrotasks()
    })

    console.log('\nAfter selection update:')
    console.log('Parent renders:', parentRenderCount)
    console.log('Row1 renders:', row1RenderCount)
    console.log('Row2 renders:', row2RenderCount)
    console.log('Row3 renders:', row3RenderCount)

    // Analysis
    console.log('\n=== Analysis ===')
    console.log(
      `Label update caused parent re-render: ${
        parentAfterLabelUpdate > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(
      `Label update caused Row1 re-render: ${
        row1AfterLabelUpdate > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(
      `Selection update caused parent re-render: ${
        parentRenderCount > parentAfterLabelUpdate ? 'YES' : 'NO'
      }`
    )
  })

  it('should test WITHOUT For component - direct mapping', async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: 'Item 1' },
        { id: 2, label: 'Item 2' },
      ],
    })

    let parentRenderCount = 0
    let row1RenderCount = 0
    let row2RenderCount = 0

    const Row = memo(({ item }: { item: any }) => {
      if (item.id === 1) row1RenderCount++
      if (item.id === 2) row2RenderCount++

      console.log(`Direct Row ${item.id} rendered - label: "${item.label}"`)

      return <div>{item.label}</div>
    })

    const DirectRowList = memo(() => {
      parentRenderCount++
      console.log(`DirectRowList rendered (render #${parentRenderCount})`)

      const state = useTracked(store)

      return (
        <div>
          {state.data.map(item => (
            <Row key={item.id} item={item} />
          ))}
        </div>
      )
    })

    render(<DirectRowList />)

    console.log('\n=== Direct Mapping Test ===')
    console.log(
      'Initial - Parent:',
      parentRenderCount,
      'Row1:',
      row1RenderCount,
      'Row2:',
      row2RenderCount
    )

    // Update label without For component
    await act(async () => {
      console.log('\n=== Updating data.0.label WITHOUT For component ===')
      updateStore({ $set: { 'data.0.label': 'Updated Item 1' } })
      await flushMicrotasks()
    })

    console.log(
      'After update - Parent:',
      parentRenderCount,
      'Row1:',
      row1RenderCount,
      'Row2:',
      row2RenderCount
    )

    console.log('\n=== Direct Mapping Analysis ===')
    console.log(
      `WITHOUT For: Parent re-rendered: ${parentRenderCount > 1 ? 'YES' : 'NO'}`
    )
    console.log(
      `WITHOUT For: Row1 re-rendered: ${row1RenderCount > 1 ? 'YES' : 'NO'}`
    )
  })

  it('should test what happens when we access individual items during update preparation', async () => {
    const [store, updateStore] = createStore({
      data: [
        { id: 1, label: 'Item 1' },
        { id: 2, label: 'Item 2' },
      ],
    })

    let parentRenderCount = 0

    const TestComponent = memo(() => {
      parentRenderCount++
      const state = useTracked(store)

      // Only access the array, not individual items
      console.log(
        `Component accessing state.data (length: ${state.data.length})`
      )

      return <div>Items: {state.data.length}</div>
    })

    render(<TestComponent />)

    console.log('\n=== Testing access pattern during update ===')
    console.log('Initial parent renders:', parentRenderCount)

    await act(async () => {
      console.log('\n=== Updating with access pattern like js-krauset ===')

      // This is exactly what js-krauset does - it accesses store.data[0].label
      // BEFORE doing the update
      const currentLabel = store.data[0].label
      console.log('Accessed store.data[0].label before update:', currentLabel)

      updateStore({
        $set: {
          'data.0.label': currentLabel + ' !!!',
        },
      })
      await flushMicrotasks()
    })

    console.log(
      'After update with pre-access - Parent renders:',
      parentRenderCount
    )

    console.log('\n=== Pre-access Analysis ===')
    console.log(
      `Pre-accessing store.data[0].label caused re-render: ${
        parentRenderCount > 1 ? 'YES' : 'NO'
      }`
    )
  })
})
