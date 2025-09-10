import { describe, it, expect, afterEach } from 'vitest'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'
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
    console.log('\n=== REGULAR MAP ANALYSIS ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const { container } = render(
      <RegularMapComponent store={store} updateStore={updateStore} />
    )

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

    // The key insight: React re-renders ALL row components even though only selection changed
    expect(results.uniqueRowsRendered).toBeGreaterThan(1)
  })

  it('analyzes React.memo rendering behavior', () => {
    resetRenderTracking()
    console.log('\n=== REACT.MEMO ANALYSIS ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const { container } = render(
      <MemoizedComponent store={store} updateStore={updateStore} />
    )

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

    // React.memo should prevent unnecessary re-renders now that proxy stability is fixed
    expect(results.uniqueRowsRendered).toBeLessThanOrEqual(2) // Only selected row should change
  })

  it('analyzes For component rendering behavior', () => {
    resetRenderTracking()
    console.log('\n=== FOR COMPONENT ANALYSIS ===')

    const data = buildData(50)
    const [store, updateStore] = createStore<AppState>({
      data,
      selected: null,
    })

    const { container } = render(
      <ForComponent store={store} updateStore={updateStore} />
    )

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

    // For component won't prevent React's reconciliation
    expect(results.uniqueRowsRendered).toBeGreaterThan(1)
  })

  it('compares all approaches with larger dataset', () => {
    console.log('\n=== COMPARISON WITH 200 ROWS ===')

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
      console.log(
        `${scenario.name}: ${renderedRowIds.size} rows re-rendered (${efficiency}% efficient)`
      )
    }
  })

  it('analyzes performance implications', () => {
    console.log('\n=== PERFORMANCE ANALYSIS ===')

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

    console.log(`1000 row table with regular map:`)
    console.log(
      `- Selection time: ${Math.round(selectEndTime - selectStartTime)}ms`
    )
    console.log(`- Components re-rendered: ${renderCount}`)
    console.log(`- Unique rows re-rendered: ${renderedRowIds.size}`)

    const selectedRow = container.querySelector('tbody tr:nth-child(501)')
    expect(selectedRow?.classList.contains('danger')).toBe(true)

    // The key finding: Even with 1000 rows, React re-renders all of them
    expect(renderedRowIds.size).toBe(data.length)
  })

  it('investigates why React.memo is not working', () => {
    console.log('\n=== REACT.MEMO INVESTIGATION ===')

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

      console.log('=== RENDER CYCLE START ===')

      // Log object references to see if they change
      state.data.forEach((row: RowData, index: number) => {
        const itemRef = row === data[index] ? 'SAME' : 'DIFFERENT'
        console.log(`Row ${row.id}: Original vs Proxied = ${itemRef}`)
      })

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

    console.log('\n--- SELECTING ROW 2 ---')

    act(() => {
      updateStore({ $set: { selected: data[1].id } })
    })

    console.log('\n--- SELECTION COMPLETE ---')

    // This test reveals that proxy objects break React.memo
    expect(container).toBeDefined()
  })

  it('verifies proxy reference stability fix enables React.memo', () => {
    console.log('\n=== PROXY REFERENCE STABILITY TEST ===')

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
})
