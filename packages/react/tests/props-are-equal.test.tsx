import { describe, it, expect, vi } from 'vitest'
import React, { memo, useCallback } from 'react'
import { render, act } from '@testing-library/react'
import { createStore } from '@storable/core'
import { useTrackedStore, propsAreEqual, For } from '../src/use-store'

describe('propsAreEqual Comparison Function', () => {
  it('should detect when proxy data changes despite stable reference', () => {
    const [store, updateStore] = createStore({
      items: [
        { id: 1, name: 'Item 1', value: 100 },
        { id: 2, name: 'Item 2', value: 200 },
        { id: 3, name: 'Item 3', value: 300 },
      ],
      selected: null as number | null,
    })

    const itemRenderCount: Record<number, number> = {}

    // Component using propsAreEqual
    const ItemWithPropsAreEqual = memo(({ item }: { item: any }) => {
      itemRenderCount[item.id] = (itemRenderCount[item.id] || 0) + 1
      return (
        <div>
          {item.name}: {item.value}
        </div>
      )
    }, propsAreEqual)

    function App() {
      const state = useTrackedStore(store)
      return (
        <div>
          {state.items.map(item => (
            <ItemWithPropsAreEqual key={item.id} item={item} />
          ))}
        </div>
      )
    }

    const { rerender } = render(<App />)

    // Initial render - all items should render once
    expect(itemRenderCount[1]).toBe(1)
    expect(itemRenderCount[2]).toBe(1)
    expect(itemRenderCount[3]).toBe(1)

    // Update item 2's value
    act(() => {
      updateStore({ $set: { 'items.1.value': 250 } })
    })

    rerender(<App />)

    // Only item 2 should have re-rendered
    expect(itemRenderCount[1]).toBe(1) // No re-render
    expect(itemRenderCount[2]).toBe(2) // Re-rendered due to change
    expect(itemRenderCount[3]).toBe(1) // No re-render
  })

  it('should skip re-render when proxy data has not changed', () => {
    const [store, updateStore] = createStore({
      items: [{ id: 1, name: 'Item 1' }],
      unrelated: 'data',
    })

    let renderCount = 0

    const Item = memo(({ item }: { item: any }) => {
      renderCount++
      return <div>{item.name}</div>
    }, propsAreEqual)

    function App() {
      const state = useTrackedStore(store)
      return <Item item={state.items[0]} />
    }

    const { rerender } = render(<App />)
    expect(renderCount).toBe(1)

    // Update unrelated data
    act(() => {
      updateStore({ $set: { unrelated: 'changed' } })
    })

    rerender(<App />)

    // Item should NOT re-render since its data didn't change
    expect(renderCount).toBe(1)
  })

  it('should handle non-proxy props correctly', () => {
    const [store, updateStore] = createStore({
      items: [{ id: 1, name: 'Item 1' }],
    })

    let renderCount = 0
    const onClick = vi.fn()

    const Item = memo(({ item, isSelected, onClick }: any) => {
      renderCount++
      return (
        <div onClick={onClick} className={isSelected ? 'selected' : ''}>
          {item.name}
        </div>
      )
    }, propsAreEqual)

    function App({ selected }: { selected: boolean }) {
      const state = useTrackedStore(store)
      return (
        <Item item={state.items[0]} isSelected={selected} onClick={onClick} />
      )
    }

    const { rerender } = render(<App selected={false} />)
    expect(renderCount).toBe(1)

    // Change isSelected prop
    rerender(<App selected={true} />)
    expect(renderCount).toBe(2) // Should re-render due to prop change

    // Same isSelected value
    rerender(<App selected={true} />)
    expect(renderCount).toBe(2) // Should NOT re-render
  })

  it('should handle props being added or removed', () => {
    let renderCount = 0

    const Component = memo((props: any) => {
      renderCount++
      return <div>{Object.keys(props).length} props</div>
    }, propsAreEqual)

    const { rerender } = render(<Component a={1} b={2} />)
    expect(renderCount).toBe(1)

    // Add a prop
    rerender(<Component a={1} b={2} c={3} />)
    expect(renderCount).toBe(2)

    // Remove a prop
    rerender(<Component a={1} />)
    expect(renderCount).toBe(3)
  })

  it('comparison: propsAreEqual vs For component performance', () => {
    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 100,
      })),
    })

    const propsAreEqualRenders: Record<number, number> = {}
    const forComponentRenders: Record<number, number> = {}

    // Test with propsAreEqual
    const ItemWithPropsAreEqual = memo(({ item }: { item: any }) => {
      propsAreEqualRenders[item.id] = (propsAreEqualRenders[item.id] || 0) + 1
      return (
        <div>
          {item.name}: {item.value}
        </div>
      )
    }, propsAreEqual)

    function AppWithPropsAreEqual() {
      const state = useTrackedStore(store)
      return (
        <div>
          {state.items.map(item => (
            <ItemWithPropsAreEqual key={item.id} item={item} />
          ))}
        </div>
      )
    }

    // Test with For component
    const ItemWithFor = memo(({ item }: { item: any }) => {
      forComponentRenders[item.id] = (forComponentRenders[item.id] || 0) + 1
      return (
        <div>
          {item.name}: {item.value}
        </div>
      )
    })

    function AppWithFor() {
      const state = useTrackedStore(store)
      return (
        <div>
          <For each={state.items}>
            {item => <ItemWithFor key={item.id} item={item} />}
          </For>
        </div>
      )
    }

    // Render both approaches
    const { rerender: rerenderPropsAreEqual } = render(<AppWithPropsAreEqual />)
    const { rerender: rerenderFor } = render(<AppWithFor />)

    // Initial render - all 100 items should render once in both
    expect(Object.keys(propsAreEqualRenders).length).toBe(100)
    expect(Object.keys(forComponentRenders).length).toBe(100)

    // Update item 50
    act(() => {
      updateStore({ $set: { 'items.49.value': 9999 } })
    })

    rerenderPropsAreEqual(<AppWithPropsAreEqual />)
    rerenderFor(<AppWithFor />)

    // Count how many items re-rendered
    const propsAreEqualRerenderedCount = Object.values(
      propsAreEqualRenders
    ).filter(count => count > 1).length
    const forRerenderedCount = Object.values(forComponentRenders).filter(
      count => count > 1
    ).length

    // Both should only re-render the one changed item
    expect(propsAreEqualRerenderedCount).toBe(1)
    expect(forRerenderedCount).toBe(1)

    // Specifically check item 50
    expect(propsAreEqualRenders[50]).toBe(2)
    expect(forComponentRenders[50]).toBe(2)

    // Check that other items didn't re-render
    expect(propsAreEqualRenders[1]).toBe(1)
    expect(propsAreEqualRenders[100]).toBe(1)
    expect(forComponentRenders[1]).toBe(1)
    expect(forComponentRenders[100]).toBe(1)

    console.log('Performance comparison:')
    console.log(
      'propsAreEqual approach - Items re-rendered:',
      propsAreEqualRerenderedCount
    )
    console.log(
      'For component approach - Items re-rendered:',
      forRerenderedCount
    )
  })

  it('should handle nested proxy objects', () => {
    const [store, updateStore] = createStore({
      user: {
        id: 1,
        profile: {
          name: 'John',
          settings: {
            theme: 'dark',
          },
        },
      },
    })

    let renderCount = 0

    const UserProfile = memo(({ user }: { user: any }) => {
      renderCount++
      return (
        <div>
          {user.profile.name} - {user.profile.settings.theme}
        </div>
      )
    }, propsAreEqual)

    function App() {
      const state = useTrackedStore(store)
      return <UserProfile user={state.user} />
    }

    const { rerender } = render(<App />)
    expect(renderCount).toBe(1)

    // Update nested property
    act(() => {
      updateStore({ $set: { 'user.profile.settings.theme': 'light' } })
    })

    rerender(<App />)

    // Should re-render because nested data changed
    expect(renderCount).toBe(2)

    // Update again to same value
    act(() => {
      updateStore({ $set: { 'user.profile.settings.theme': 'light' } })
    })

    rerender(<App />)

    // Should still re-render (version changes even if value is same)
    // This is a limitation but consistent with the library's behavior
    expect(renderCount).toBe(3)
  })

  it('benchmark: large list performance', () => {
    const ITEM_COUNT = 1000

    const [store, updateStore] = createStore({
      items: Array.from({ length: ITEM_COUNT }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i,
      })),
    })

    let totalRenders = 0

    const Item = memo(({ item }: { item: any }) => {
      totalRenders++
      return <span>{item.value}</span>
    }, propsAreEqual)

    function App() {
      const state = useTrackedStore(store)
      return (
        <div>
          {state.items.map(item => (
            <Item key={item.id} item={item} />
          ))}
        </div>
      )
    }

    const startTime = performance.now()
    const { rerender } = render(<App />)
    const initialRenderTime = performance.now() - startTime

    expect(totalRenders).toBe(ITEM_COUNT)

    // Update multiple items
    const updateStartTime = performance.now()
    act(() => {
      // Update every 10th item (100 items total)
      const updates: Record<string, number> = {}
      for (let i = 0; i < ITEM_COUNT; i += 10) {
        updates[`items.${i}.value`] = i * 2
      }
      updateStore({ $set: updates })
    })

    rerender(<App />)
    const updateTime = performance.now() - updateStartTime

    // Should have rendered initial + 100 updates
    expect(totalRenders).toBe(ITEM_COUNT + 100)

    console.log(`Performance with ${ITEM_COUNT} items:`)
    console.log(`Initial render: ${initialRenderTime.toFixed(2)}ms`)
    console.log(`Update 100 items: ${updateTime.toFixed(2)}ms`)
    console.log(`Average per-item update: ${(updateTime / 100).toFixed(2)}ms`)
  })
})
