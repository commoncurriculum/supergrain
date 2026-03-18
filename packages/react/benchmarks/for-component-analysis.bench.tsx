import { bench, describe, afterEach } from 'vitest'
import { createStore } from '@supergrain/core'
import { tracked } from '@supergrain/react'
import React, { FC, memo, useState, useRef } from 'react'
import {
  render,
  fireEvent,
  act,
  renderHook,
  cleanup,
} from '@testing-library/react'

/**
 * For Component Analysis Benchmarks
 *
 * This benchmark suite analyzes whether a special <For> component
 * provides performance benefits over regular .map() for array iteration
 * in React, specifically for row selection scenarios.
 *
 * Key questions we're answering:
 * 1. Do all components re-render when selecting a row?
 * 2. Can a <For> component prevent unnecessary re-renders?
 * 3. How does React.memo compare to a <For> component?
 * 4. What's the real bottleneck in large list rendering?
 */

// --- Data Generation ---
let idCounter = 1
const adjectives = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
]
const colours = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'white',
  'black',
  'orange',
]
const nouns = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
]

const _random = (max: number) => Math.round(Math.random() * 1000) % max

interface RowData {
  id: number
  label: string
}

const buildData = (count = 1000): RowData[] => {
  const data: RowData[] = new Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${
        colours[_random(colours.length)]
      } ${nouns[_random(nouns.length)]}`,
    }
  }
  idCounter = 1 // Reset for consistency
  return data
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

// Regular Row component with render tracking
const Row: FC<{
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
      <td className="col-md-6"></td>
    </tr>
  )
}

// Memoized Row component
const MemoizedRow = memo<{
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
      <td className="col-md-6"></td>
    </tr>
  )
})

// For Component implementation
const For: FC<{
  each: RowData[]
  children: (item: RowData, index: number) => React.ReactElement
}> = ({ each, children }) => {
  // Track that For itself rendered
  renderCount++

  return <>{each.map((item, index) => children(item, index))}</>
}

// For Component with internal memoization attempt
const OptimizedFor: FC<{
  each: RowData[]
  selected: number | null
  children: (
    item: RowData,
    index: number,
    isSelected: boolean
  ) => React.ReactElement
}> = ({ each, selected, children }) => {
  const prevSelectedRef = useRef<number | null>(null)
  const [, forceUpdate] = useState(0)

  renderCount++

  // Only render items that have selection state changes
  return (
    <>
      {each.map((item, index) => {
        const isSelected = selected === item.id
        const wasSelected = prevSelectedRef.current === item.id

        // This is our attempt at optimization - only render if selection changed
        if (isSelected || wasSelected) {
          return children(item, index, isSelected)
        }

        // Return a placeholder that doesn't trigger render tracking
        return (
          <tr key={item.id} className="">
            <td>{item.id}</td>
            <td>
              <a>{item.label} (Cached)</a>
            </td>
            <td className="col-md-6"></td>
          </tr>
        )
      })}
    </>
  )
}

// Test Components
const RegularMapComponent = tracked(({
  store,
  updateStore,
}: {
  store: any
  updateStore: any
}) => {
  const selectRow = (id: number) => updateStore({ $set: { selected: id } })

  return (
    <table>
      <tbody>
        {store.data.map((row: RowData) => (
          <Row
            key={row.id}
            item={row}
            isSelected={row.id === store.selected}
            onClick={selectRow}
          />
        ))}
      </tbody>
    </table>
  )
})

const MemoizedMapComponent = tracked(({
  store,
  updateStore,
}: {
  store: any
  updateStore: any
}) => {
  const selectRow = (id: number) => updateStore({ $set: { selected: id } })

  return (
    <table>
      <tbody>
        {store.data.map((row: RowData) => (
          <MemoizedRow
            key={row.id}
            item={row}
            isSelected={row.id === store.selected}
            onClick={selectRow}
          />
        ))}
      </tbody>
    </table>
  )
})

const ForComponent = tracked(({
  store,
  updateStore,
}: {
  store: any
  updateStore: any
}) => {
  const selectRow = (id: number) => updateStore({ $set: { selected: id } })

  return (
    <table>
      <tbody>
        <For each={store.data}>
          {row => (
            <Row
              key={row.id}
              item={row}
              isSelected={row.id === store.selected}
              onClick={selectRow}
            />
          )}
        </For>
      </tbody>
    </table>
  )
})

const OptimizedForComponent = tracked(({
  store,
  updateStore,
}: {
  store: any
  updateStore: any
}) => {
  const selectRow = (id: number) => updateStore({ $set: { selected: id } })

  return (
    <table>
      <tbody>
        <OptimizedFor each={store.data} selected={store.selected}>
          {(row, index, isSelected) => (
            <Row
              key={row.id}
              item={row}
              isSelected={isSelected}
              onClick={selectRow}
            />
          )}
        </OptimizedFor>
      </tbody>
    </table>
  )
})

// --- Benchmark Implementation ---
describe('For Component Analysis', () => {
  afterEach(() => {
    cleanup()
    resetRenderTracking()
  })

  // ==============================================================
  // Render Count Analysis - Understanding React's Behavior
  // These benchmarks measure not just performance, but HOW MANY
  // components actually re-render when selecting a row.
  // ==============================================================

  bench(
    'analysis: regular map - count renders on row select',
    () => {
      resetRenderTracking()

      const data = buildData(100)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <RegularMapComponent store={store} updateStore={updateStore} />
      )

      // Reset render count after initial render
      resetRenderTracking()

      // Select row 50
      act(() => {
        updateStore({ $set: { selected: data[50].id } })
      })

      // Verify the selection worked
      const selectedRow = container.querySelector('tbody tr:nth-child(51)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }

      // Store results for analysis (we'll check these in the console)
      ;(globalThis as any).lastRegularMapAnalysis = {
        totalRenders: renderCount,
        uniqueRowsRendered: renderedRowIds.size,
        renderedRowIds: Array.from(renderedRowIds).sort((a, b) => a - b),
        expectedOptimal: 1, // Only the selected row should re-render
        actualVsOptimal: `${renderedRowIds.size}x more than optimal`,
      }
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )

  bench(
    'analysis: memoized rows - count renders on row select',
    () => {
      resetRenderTracking()

      const data = buildData(100)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <MemoizedMapComponent store={store} updateStore={updateStore} />
      )

      resetRenderTracking()

      act(() => {
        updateStore({ $set: { selected: data[50].id } })
      })

      const selectedRow = container.querySelector('tbody tr:nth-child(51)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }

      ;(globalThis as any).lastMemoizedAnalysis = {
        totalRenders: renderCount,
        uniqueRowsRendered: renderedRowIds.size,
        renderedRowIds: Array.from(renderedRowIds).sort((a, b) => a - b),
        expectedOptimal: 1,
        actualVsOptimal: `${renderedRowIds.size}x more than optimal`,
      }
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )

  bench(
    'analysis: For component - count renders on row select',
    () => {
      resetRenderTracking()

      const data = buildData(100)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <ForComponent store={store} updateStore={updateStore} />
      )

      resetRenderTracking()

      act(() => {
        updateStore({ $set: { selected: data[50].id } })
      })

      const selectedRow = container.querySelector('tbody tr:nth-child(51)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }

      ;(globalThis as any).lastForAnalysis = {
        totalRenders: renderCount,
        uniqueRowsRendered: renderedRowIds.size,
        renderedRowIds: Array.from(renderedRowIds).sort((a, b) => a - b),
        expectedOptimal: 1,
        actualVsOptimal: `${renderedRowIds.size}x more than optimal`,
      }
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )

  // ==============================================================
  // Performance Comparison - Speed Analysis
  // These measure actual rendering performance between approaches
  // ==============================================================

  bench(
    'perf: regular map - 1000 rows select',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <RegularMapComponent store={store} updateStore={updateStore} />
      )

      act(() => {
        updateStore({ $set: { selected: data[500].id } })
      })

      const selectedRow = container.querySelector('tbody tr:nth-child(501)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }
    },
    {
      warmupIterations: 3,
      iterations: 10,
    }
  )

  bench(
    'perf: memoized rows - 1000 rows select',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <MemoizedMapComponent store={store} updateStore={updateStore} />
      )

      act(() => {
        updateStore({ $set: { selected: data[500].id } })
      })

      const selectedRow = container.querySelector('tbody tr:nth-child(501)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }
    },
    {
      warmupIterations: 3,
      iterations: 10,
    }
  )

  bench(
    'perf: For component - 1000 rows select',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <ForComponent store={store} updateStore={updateStore} />
      )

      act(() => {
        updateStore({ $set: { selected: data[500].id } })
      })

      const selectedRow = container.querySelector('tbody tr:nth-child(501)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }
    },
    {
      warmupIterations: 3,
      iterations: 10,
    }
  )

  // ==============================================================
  // Real-world Scenario: Multiple Selections
  // Test how each approach handles repeated selections
  // ==============================================================

  bench(
    'scenario: regular map - 10 sequential selections',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <RegularMapComponent store={store} updateStore={updateStore} />
      )

      // Perform 10 different selections
      for (let i = 0; i < 10; i++) {
        act(() => {
          updateStore({ $set: { selected: data[i * 100].id } })
        })
      }

      // Verify final selection
      const finalSelected = container.querySelector('tbody tr:nth-child(901)')
      if (!finalSelected?.classList.contains('danger')) {
        throw new Error('Final selection failed')
      }
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )

  bench(
    'scenario: memoized rows - 10 sequential selections',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <MemoizedMapComponent store={store} updateStore={updateStore} />
      )

      for (let i = 0; i < 10; i++) {
        act(() => {
          updateStore({ $set: { selected: data[i * 100].id } })
        })
      }

      const finalSelected = container.querySelector('tbody tr:nth-child(901)')
      if (!finalSelected?.classList.contains('danger')) {
        throw new Error('Final selection failed')
      }
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )

  bench(
    'scenario: For component - 10 sequential selections',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <ForComponent store={store} updateStore={updateStore} />
      )

      for (let i = 0; i < 10; i++) {
        act(() => {
          updateStore({ $set: { selected: data[i * 100].id } })
        })
      }

      const finalSelected = container.querySelector('tbody tr:nth-child(901)')
      if (!finalSelected?.classList.contains('danger')) {
        throw new Error('Final selection failed')
      }
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )
})

// Make analysis results available globally for inspection
declare global {
  var lastRegularMapAnalysis: any
  var lastMemoizedAnalysis: any
  var lastForAnalysis: any
}
