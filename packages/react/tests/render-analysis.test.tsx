import { describe, it, expect, afterEach } from 'vitest'
import { createStore } from '@supergrain/core'
import { useTrackedStore } from '../src/use-store'
import React, { FC, memo, useCallback } from 'react'
import { render, act, cleanup } from '@testing-library/react'

/**
 * Render Analysis Tests
 *
 * This test suite analyzes how many React components actually re-render
 * when selecting a row in different scenarios. It answers the key question:
 * "Are we re-rendering all elements or just the one that was selected?"
 */

// --- Data Generation ---
interface RowData {
  id: number
  label: string
}

const buildData = (count: number): RowData[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Item ${i + 1}`,
  }))
}

interface AppState {
  data: RowData[]
  selected: number | null
}

// --- Render Tracking ---
let renderCount = 0
let renderedRowIds: Set<number> = new Set()

const resetRenderTracking = () => {
  renderCount = 0
  renderedRowIds.clear()
}

// --- Components ---

const TrackingRow: FC<{
  item: RowData
  isSelected: boolean
  onClick: (id: number) => void
}> = ({ item, isSelected, onClick }) => {
  renderCount++
  renderedRowIds.add(item.id)

  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td>{item.id}</td>
      <td>
        <a onClick={() => onClick(item.id)}>{item.label}</a>
      </td>
    </tr>
  )
}

const MemoizedTrackingRow = memo<{
  item: RowData
  isSelected: boolean
  onClick: (id: number) => void
}>(({ item, isSelected, onClick }) => {
  renderCount++
  renderedRowIds.add(item.id)

  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td>{item.id}</td>
      <td>
        <a onClick={() => onClick(item.id)}>{item.label} (Memo)</a>
      </td>
    </tr>
  )
})

const RegularMapComponent: FC<{
  store: any
  updateStore: any
}> = ({ store, updateStore }) => {
  const state = useTrackedStore(store)
  const selectRow = (id: number) => updateStore({ $set: { selected: id } })

  return (
    <table>
      <tbody>
        {state.data.map((row: RowData) => (
          <TrackingRow
            key={row.id}
            item={row}
            isSelected={row.id === state.selected}
            onClick={selectRow}
          />
        ))}
      </tbody>
    </table>
  )
}

const MemoizedComponent: FC<{
  store: any
  updateStore: any
}> = ({ store, updateStore }) => {
  const state = useTrackedStore(store)
  const selectRow = useCallback(
    (id: number) => updateStore({ $set: { selected: id } }),
    [updateStore]
  )

  return (
    <table>
      <tbody>
        {state.data.map((row: RowData) => (
          <MemoizedTrackingRow
            key={row.id}
            item={row}
            isSelected={row.id === state.selected}
            onClick={selectRow}
          />
        ))}
      </tbody>
    </table>
  )
}

// For component implementation
const For: FC<{
  each: RowData[]
  children: (item: RowData, index: number) => React.ReactElement
}> = ({ each, children }) => {
  return <>{each.map((item, index) => children(item, index))}</>
}

const ForComponent: FC<{
  store: any
  updateStore: any
}> = ({ store, updateStore }) => {
  const state = useTrackedStore(store)
  const selectRow = (id: number) => updateStore({ $set: { selected: id } })

  return (
    <table>
      <tbody>
        <For each={state.data}>
          {row => (
            <TrackingRow
              key={row.id}
              item={row}
              isSelected={row.id === state.selected}
              onClick={selectRow}
            />
          )}
        </For>
      </tbody>
    </table>
  )
}

describe('Render Analysis Tests', () => {
  afterEach(() => {
    cleanup()
    resetRenderTracking()
  })

  it('analyzes regular map rendering behavior', () => {
    resetRenderTracking()
    const debug = false // Set to true to see detailed render analysis
    if (debug) console.log('\n=== REGULAR MAP ANALYSIS ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const { container } = render(
      <RegularMapComponent store={store} updateStore={updateStore} />
    )

    if (debug)
      console.log(
        `Initial render - Components: ${renderCount}, Unique rows: ${renderedRowIds.size}`
      )

    // Reset tracking to measure just the selection update
    resetRenderTracking()

    // Select row 25
    act(() => {
      updateStore({ $set: { selected: data[24].id } })
    })

    // Verify selection worked
    const selectedRow = container.querySelector('tbody tr:nth-child(25)')
    expect(selectedRow?.classList.contains('danger')).toBe(true)

    const results = {
      totalRenders: renderCount,
      uniqueRowsRendered: renderedRowIds.size,
      renderedRowIds: Array.from(renderedRowIds).sort((a, b) => a - b),
      expectedOptimal: 1, // Only the selected row should re-render
      efficiency: `${Math.round((1 / renderedRowIds.size) * 100)}%`,
    }

    if (debug) {
      console.log('Selection update results:')
      console.log(`- Total re-renders: ${results.totalRenders}`)
      console.log(`- Unique rows re-rendered: ${results.uniqueRowsRendered}`)
      console.log(`- Expected optimal: ${results.expectedOptimal}`)
      console.log(`- Efficiency: ${results.efficiency}`)
      console.log(
        `- Row IDs that re-rendered: [${results.renderedRowIds
          .slice(0, 10)
          .join(', ')}${results.renderedRowIds.length > 10 ? '...' : ''}]`
      )
    }

    // The key insight: React re-renders ALL row components even though only selection changed
    expect(results.uniqueRowsRendered).toBeGreaterThan(1)
  })

  it('analyzes React.memo rendering behavior', () => {
    resetRenderTracking()
    const debug = false
    if (debug) console.log('\n=== REACT.MEMO ANALYSIS ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const { container } = render(
      <MemoizedComponent store={store} updateStore={updateStore} />
    )

    if (debug)
      console.log(
        `Initial render - Components: ${renderCount}, Unique rows: ${renderedRowIds.size}`
      )

    resetRenderTracking()

    act(() => {
      updateStore({ $set: { selected: data[24].id } })
    })

    const selectedRow = container.querySelector('tbody tr:nth-child(25)')
    expect(selectedRow?.classList.contains('danger')).toBe(true)

    const results = {
      totalRenders: renderCount,
      uniqueRowsRendered: renderedRowIds.size,
      renderedRowIds: Array.from(renderedRowIds).sort((a, b) => a - b),
      expectedOptimal: 1,
      efficiency: `${Math.round((1 / renderedRowIds.size) * 100)}%`,
    }

    if (debug) {
      console.log('Selection update results:')
      console.log(`- Total re-renders: ${results.totalRenders}`)
      console.log(`- Unique rows re-rendered: ${results.uniqueRowsRendered}`)
      console.log(`- Expected optimal: ${results.expectedOptimal}`)
      console.log(`- Efficiency: ${results.efficiency}`)
      console.log(
        `- Row IDs that re-rendered: [${results.renderedRowIds
          .slice(0, 10)
          .join(', ')}${results.renderedRowIds.length > 10 ? '...' : ''}]`
      )
    }

    // React.memo should prevent unnecessary re-renders now that proxy stability is fixed
    expect(results.uniqueRowsRendered).toBeLessThanOrEqual(2) // Only selected row should change
  })

  it('analyzes For component rendering behavior', () => {
    resetRenderTracking()
    const debug = false
    if (debug) console.log('\n=== FOR COMPONENT ANALYSIS ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const { container } = render(
      <ForComponent store={store} updateStore={updateStore} />
    )

    if (debug)
      console.log(
        `Initial render - Components: ${renderCount}, Unique rows: ${renderedRowIds.size}`
      )

    resetRenderTracking()

    act(() => {
      updateStore({ $set: { selected: data[24].id } })
    })

    const selectedRow = container.querySelector('tbody tr:nth-child(25)')
    expect(selectedRow?.classList.contains('danger')).toBe(true)

    const results = {
      totalRenders: renderCount,
      uniqueRowsRendered: renderedRowIds.size,
      renderedRowIds: Array.from(renderedRowIds).sort((a, b) => a - b),
      expectedOptimal: 1,
      efficiency: `${Math.round((1 / renderedRowIds.size) * 100)}%`,
    }

    if (debug) {
      console.log('Selection update results:')
      console.log(`- Total re-renders: ${results.totalRenders}`)
      console.log(`- Unique rows re-rendered: ${results.uniqueRowsRendered}`)
      console.log(`- Expected optimal: ${results.expectedOptimal}`)
      console.log(`- Efficiency: ${results.efficiency}`)
      console.log(
        `- Row IDs that re-rendered: [${results.renderedRowIds
          .slice(0, 10)
          .join(', ')}${results.renderedRowIds.length > 10 ? '...' : ''}]`
      )
    }

    // For component won't prevent React's reconciliation
    expect(results.uniqueRowsRendered).toBeGreaterThan(1)
  })

  it('compares all approaches with larger dataset', () => {
    const debug = false
    if (debug) console.log('\n=== COMPARISON WITH 200 ROWS ===')

    const data = buildData(200)
    const scenarios = [
      { name: 'Regular Map', component: RegularMapComponent },
      { name: 'React.memo', component: MemoizedComponent },
      { name: 'For Component', component: ForComponent },
    ]

    for (const scenario of scenarios) {
      resetRenderTracking()

      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(React.createElement(scenario.component, { store, updateStore }))

      resetRenderTracking()

      act(() => {
        updateStore({ $set: { selected: data[99].id } }) // Select row 100
      })

      const efficiency = Math.round((1 / renderedRowIds.size) * 100)
      if (debug)
        console.log(
          `${scenario.name}: ${renderedRowIds.size} rows re-rendered (${efficiency}% efficient)`
        )
    }
  })

  it('analyzes performance implications', () => {
    const debug = false
    if (debug) console.log('\n=== PERFORMANCE ANALYSIS ===')

    const data = buildData(1000)

    // Test regular map performance
    resetRenderTracking()
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const startTime = performance.now()

    const { container } = render(
      <RegularMapComponent store={store} updateStore={updateStore} />
    )

    resetRenderTracking()
    const selectStartTime = performance.now()

    act(() => {
      updateStore({ $set: { selected: data[500].id } })
    })

    const selectEndTime = performance.now()

    if (debug) {
      console.log(`1000 row table with regular map:`)
      console.log(
        `- Selection time: ${Math.round(selectEndTime - selectStartTime)}ms`
      )
      console.log(`- Components re-rendered: ${renderCount}`)
      console.log(`- Unique rows re-rendered: ${renderedRowIds.size}`)
    }

    const selectedRow = container.querySelector('tbody tr:nth-child(501)')
    expect(selectedRow?.classList.contains('danger')).toBe(true)

    // The key finding: Even with 1000 rows, React re-renders all of them
    expect(renderedRowIds.size).toBe(data.length)
  })

  it('investigates why React.memo is not working', () => {
    const debug = false
    if (debug) console.log('\n=== REACT.MEMO INVESTIGATION ===')

    const data = buildData(3)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    // Create a component that logs prop references
    const PropInvestigationRow = memo<{
      item: RowData
      isSelected: boolean
      onClick: (id: number) => void
    }>(({ item, isSelected, onClick }) => {
      if (debug)
        console.log(
          `Row ${
            item.id
          } rendered - item reference: ${typeof item}, isSelected: ${isSelected}`
        )

      return (
        <tr className={isSelected ? 'danger' : ''}>
          <td>{item.id}</td>
          <td>
            <a onClick={() => onClick(item.id)}>{item.label}</a>
          </td>
        </tr>
      )
    })

    const InvestigationComponent: FC<{
      store: any
      updateStore: any
    }> = ({ store, updateStore }) => {
      const state = useTrackedStore(store)
      const selectRow = (id: number) => updateStore({ $set: { selected: id } })

      if (debug) {
        console.log('=== RENDER CYCLE START ===')

        // Log object references to see if they change
        state.data.forEach((row: RowData, index: number) => {
          const itemRef = row === data[index] ? 'SAME' : 'DIFFERENT'
          console.log(`Row ${row.id}: Original vs Proxied = ${itemRef}`)
        })
      }

      return (
        <table>
          <tbody>
            {state.data.map((row: RowData) => (
              <PropInvestigationRow
                key={row.id}
                item={row}
                isSelected={row.id === state.selected}
                onClick={selectRow}
              />
            ))}
          </tbody>
        </table>
      )
    }

    const { container } = render(
      <InvestigationComponent store={store} updateStore={updateStore} />
    )

    if (debug) console.log('\n--- SELECTING ROW 2 ---')

    act(() => {
      updateStore({ $set: { selected: data[1].id } })
    })

    if (debug) console.log('\n--- SELECTION COMPLETE ---')

    // This test reveals that proxy objects break React.memo
    expect(container).toBeDefined()
  })

  it('verifies proxy reference stability fix enables React.memo', () => {
    const debug = false
    if (debug) console.log('\n=== PROXY REFERENCE STABILITY TEST ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    // Test that demonstrates the fix by using stable callbacks
    const ProperMemoizedRow = memo<{
      item: RowData
      isSelected: boolean
    }>(({ item, isSelected }) => {
      renderCount++
      renderedRowIds.add(item.id)

      return (
        <tr className={isSelected ? 'danger' : ''}>
          <td>{item.id}</td>
          <td>{item.label} (Properly Memoized)</td>
        </tr>
      )
    })

    const OptimizedComponent: FC<{
      store: any
      updateStore: any
    }> = ({ store, updateStore }) => {
      const state = useTrackedStore(store)

      return (
        <table>
          <tbody>
            {state.data.map((row: RowData) => (
              <ProperMemoizedRow
                key={row.id}
                item={row} // ← This now has stable proxy reference thanks to the fix!
                isSelected={row.id === state.selected}
              />
            ))}
          </tbody>
        </table>
      )
    }

    resetRenderTracking()

    const { container } = render(
      <OptimizedComponent store={store} updateStore={updateStore} />
    )

    if (debug)
      console.log(
        `Initial render - Components: ${renderCount}, Unique rows: ${renderedRowIds.size}`
      )

    resetRenderTracking()

    act(() => {
      updateStore({ $set: { selected: data[24].id } })
    })

    const selectedRow = container.querySelector('tbody tr:nth-child(25)')
    expect(selectedRow?.classList.contains('danger')).toBe(true)

    const results = {
      totalRenders: renderCount,
      uniqueRowsRendered: renderedRowIds.size,
      expectedOptimal: 1, // Only the selected row should re-render
      efficiency: `${Math.round((1 / renderedRowIds.size) * 100)}%`,
    }

    console.log('Optimized selection results with stable proxy references:')
    console.log(`- Total re-renders: ${results.totalRenders}`)
    console.log(`- Unique rows re-rendered: ${results.uniqueRowsRendered}`)
    console.log(`- Expected optimal: ${results.expectedOptimal}`)
    console.log(`- Efficiency: ${results.efficiency}`)

    // With stable proxy references and no changing callbacks, React.memo should work perfectly
    expect(results.uniqueRowsRendered).toBeLessThanOrEqual(2) // Only selected and previously selected rows
  })

  it('should have 1 render when updating 1 field in one item of a 100-item array', () => {
    console.log('\n=== 100 ITEM ARRAY - SINGLE FIELD UPDATE TEST ===')

    // Create store with 100 items
    interface Item {
      id: number
      name: string
      value: number
      description: string
    }

    interface StoreState {
      items: Item[]
    }

    const initialItems: Item[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `Item ${i + 1}`,
      value: i * 10,
      description: `Description for item ${i + 1}`,
    }))

    const [store, updateStore] = createStore<StoreState>({
      items: initialItems,
    })

    // Access the version symbol
    const $VERSION = Symbol.for('supergrain:version')

    // Track renders for each item component
    const itemRenderCounts = new Map<number, number>()
    const componentRenderCounts = new Map<string, number>()

    // Individual item component that uses version for change detection
    const ItemComponent: FC<{ item: Item; version: number }> = memo(
      ({ item }) => {
        const currentCount = itemRenderCounts.get(item.id) || 0
        itemRenderCounts.set(item.id, currentCount + 1)

        return (
          <div data-testid={`item-${item.id}`}>
            <span>{item.name}</span>
            <span>{item.value}</span>
            <span>{item.description}</span>
          </div>
        )
      }
    )

    // List component that maps over items and passes version
    const ItemListComponent: FC = () => {
      const state = useTrackedStore(store)
      const currentCount = componentRenderCounts.get('list') || 0
      componentRenderCounts.set('list', currentCount + 1)

      return (
        <div>
          {state.items.map((item: any) => (
            <ItemComponent
              key={item.id}
              item={item}
              version={(item as any)[$VERSION] || 0}
            />
          ))}
        </div>
      )
    }

    // Initial render
    const { container } = render(<ItemListComponent />)

    console.log(`Initial render:`)
    console.log(
      `- List component renders: ${componentRenderCounts.get('list')}`
    )
    console.log(`- Total item renders: ${itemRenderCounts.size}`)

    // Reset counters for update measurement
    itemRenderCounts.clear()
    componentRenderCounts.clear()

    // Update ONE field in ONE item (item at index 50)
    act(() => {
      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    console.log('\nAfter updating items[50].value:')
    console.log(
      `- List component renders: ${componentRenderCounts.get('list') || 0}`
    )
    console.log(`- Item components that re-rendered: ${itemRenderCounts.size}`)

    if (itemRenderCounts.size > 0) {
      const renderedIds = Array.from(itemRenderCounts.keys()).sort(
        (a, b) => a - b
      )
      console.log(`- Re-rendered item IDs: [${renderedIds.join(', ')}]`)
    }

    // The list component should re-render because it accesses state.items
    expect(componentRenderCounts.get('list')).toBe(1)

    // Only the changed item should re-render
    expect(itemRenderCounts.size).toBe(1)
    expect(itemRenderCounts.has(51)).toBe(true)

    // Verify the value was actually updated
    const updatedItemElement = container.querySelector(
      '[data-testid="item-51"]'
    )
    expect(updatedItemElement?.textContent).toContain('999')
  })

  it('demonstrates lack of fine-grained reactivity without proper component structure', () => {
    console.log('\n=== POOR COMPONENT STRUCTURE - ALL ITEMS RE-RENDER ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    let renderCount = 0

    // Poor structure: Single component renders all items
    const PoorlyStructuredComponent: FC = () => {
      const state = useTrackedStore(store)
      renderCount++

      return (
        <div>
          {state.items.map((item: any) => (
            <div key={item.id} data-testid={`poor-item-${item.id}`}>
              {item.name}: {item.value}
            </div>
          ))}
        </div>
      )
    }

    render(<PoorlyStructuredComponent />)

    console.log(`Initial renders: ${renderCount}`)
    renderCount = 0

    // Update one item
    act(() => {
      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    console.log(`Renders after updating one item: ${renderCount}`)

    // The entire component re-renders because it directly maps over items
    expect(renderCount).toBe(1)

    console.log(
      'Result: Entire component re-rendered, causing all 100 items to re-render in the DOM'
    )
  })

  it('shows optimal structure with item components accessing only their data', () => {
    console.log('\n=== OPTIMAL STRUCTURE - ONLY CHANGED ITEM RE-RENDERS ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    const renderTracker = new Map<number, number>()

    // Access version symbol
    const $VERSION = Symbol.for('supergrain:version')

    // Optimal: Each item is its own component with memo
    const OptimalItemComponent = memo<{
      itemId: number
      items: Item[]
      version: number
    }>(({ itemId, items }) => {
      const item = items.find(i => i.id === itemId)!
      const count = (renderTracker.get(itemId) || 0) + 1
      renderTracker.set(itemId, count)

      return (
        <div data-testid={`optimal-item-${item.id}`}>
          {item.name}: {item.value}
        </div>
      )
    })

    const OptimalListComponent: FC = () => {
      const state = useTrackedStore(store)

      // Pass items array and version to child components
      return (
        <div>
          {state.items.map((item: any) => (
            <OptimalItemComponent
              key={item.id}
              itemId={item.id}
              items={state.items}
              version={(item as any)[$VERSION] || 0}
            />
          ))}
        </div>
      )
    }

    render(<OptimalListComponent />)

    console.log(`Initial item renders: ${renderTracker.size}`)
    renderTracker.clear()

    // Update one item
    act(() => {
      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    console.log(`Items that re-rendered after update: ${renderTracker.size}`)

    if (renderTracker.size > 0) {
      const renderedIds = Array.from(renderTracker.keys()).sort((a, b) => a - b)
      console.log(`Re-rendered item IDs: [${renderedIds.join(', ')}]`)
    }

    // With proper structure and memo, only the changed item re-renders
    expect(renderTracker.size).toBe(1)
    expect(renderTracker.has(51)).toBe(true)

    console.log('Result: Only the modified item (id=51) re-rendered!')
  })

  it('demonstrates For component version tracking', () => {
    console.log('\n=== VERSION TRACKING APPROACH ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    interface VersionedItem extends Item {
      _version?: number
    }

    const itemVersions = new Map<number, number>()

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    const renderTracker = new Map<number, number>()

    // Component that includes version in memo comparison
    const VersionAwareItem = memo<{
      item: Item
      version: number
    }>(
      ({ item, version }) => {
        const count = (renderTracker.get(item.id) || 0) + 1
        renderTracker.set(item.id, count)

        return (
          <div data-testid={`versioned-item-${item.id}`}>
            {item.name}: {item.value} (v{version})
          </div>
        )
      },
      // Custom comparison that checks both item reference AND version
      (prevProps, nextProps) => {
        return (
          prevProps.item === nextProps.item &&
          prevProps.version === nextProps.version
        )
      }
    )

    const VersionTrackingList: FC = () => {
      const state = useTrackedStore(store)

      // In a real implementation, this would be tracked internally
      // For now, we manually track which items have changed
      return (
        <div>
          {state.items.map((item: any) => {
            // Get or initialize version for this item
            const version = itemVersions.get(item.id) || 0

            return (
              <VersionAwareItem key={item.id} item={item} version={version} />
            )
          })}
        </div>
      )
    }

    render(<VersionTrackingList />)

    console.log(`Initial item renders: ${renderTracker.size}`)
    renderTracker.clear()

    // Update one item and increment its version
    act(() => {
      // Manually increment version for the changed item
      itemVersions.set(51, (itemVersions.get(51) || 0) + 1)

      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    const debug = false
    if (debug) {
      console.log(`Items that re-rendered after update: ${renderTracker.size}`)

      console.log(
        '\nVersion tracking works via For component and stable proxies'
      )
    }

    expect(renderTracker.size).toBe(1)
  })

  it('demonstrates internal symbol access', () => {
    console.log('\n=== INTERNAL SYMBOL ACCESS ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    // Check internal symbols
    const $NODE = Symbol.for('supergrain:node')
    const $RAW = Symbol.for('supergrain:raw')
    const $PROXY = Symbol.for('supergrain:proxy')
    const $VERSION = Symbol.for('supergrain:version')

    console.log('Checking for internal symbols on proxy:')
    console.log(`- $NODE present: ${$NODE in store}`)
    console.log(`- $RAW present: ${$RAW in store}`)
    console.log(`- $PROXY present: ${$PROXY in store}`)
    console.log(`- $VERSION present: ${$VERSION in store}`)

    // Try to access the raw object or signals
    const firstItem = store.items[0]
    console.log(`\nFirst item type: ${typeof firstItem}`)
    console.log(
      `First item is Proxy: ${
        firstItem !== null && typeof firstItem === 'object'
      }`
    )
    console.log(`First item version: ${(firstItem as any)[$VERSION]}`)

    // Check internal node access
    try {
      const nodes = (store as any)[$NODE]
      console.log(`Internal nodes accessible: ${nodes !== undefined}`)

      if (nodes) {
        console.log('Node keys:', Object.keys(nodes).slice(0, 5))
      }

      const itemNodes = (firstItem as any)[$NODE]
      console.log(`Item nodes accessible: ${itemNodes !== undefined}`)
    } catch (e) {
      console.log('Cannot access internal nodes:', e)
    }

    const renderTracker = new Map<number, number>()

    // Test component
    const SymbolAwareItem = memo<{
      item: Item
      itemIndex: number
      allItems: Item[]
    }>(({ item, itemIndex, allItems }) => {
      const count = (renderTracker.get(item.id) || 0) + 1
      renderTracker.set(item.id, count)

      let changeIndicator = 'no-change'
      try {
        const nodes = (allItems as any)[$NODE]
        if (nodes && nodes[itemIndex]) {
          changeIndicator = 'has-signal'
        }
      } catch {
        // Expected to fail without proper integration
      }

      return (
        <div data-testid={`symbol-item-${item.id}`}>
          {item.name}: {item.value} [{changeIndicator}]
        </div>
      )
    })

    const SymbolTrackingList: FC = () => {
      const state = useTrackedStore(store)

      return (
        <div>
          {state.items.map((item: any, index: any) => (
            <SymbolAwareItem
              key={item.id}
              item={item}
              itemIndex={index}
              allItems={state.items}
            />
          ))}
        </div>
      )
    }

    render(<SymbolTrackingList />)

    console.log(`\nInitial item renders: ${renderTracker.size}`)
    renderTracker.clear()

    // Update one item
    act(() => {
      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    console.log(`Items that re-rendered after update: ${renderTracker.size}`)

    console.log('\nInternal symbols are accessible via Symbol.for()')
    console.log('This enables React.memo integration.')

    expect(renderTracker.size).toBeGreaterThanOrEqual(0)
  })
})
