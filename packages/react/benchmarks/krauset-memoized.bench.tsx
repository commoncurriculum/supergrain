import { bench, describe } from 'vitest'
import { createStore } from '@storable/core'
import { useTrackedStore } from '@storable/react'
import React, { FC, memo, useCallback } from 'react'
import { render, act } from '@testing-library/react'

/**
 * Krauset-style Benchmark: Memoized vs Unmemoized Rows
 *
 * This benchmark measures the performance impact of using React.memo
 * with the proxy reference stability fix. It simulates the classic
 * js-framework-benchmark scenarios to compare:
 *
 * 1. Unmemoized rows (all rows re-render on any change)
 * 2. Memoized rows (only affected rows re-render)
 *
 * Expected results with proxy reference stability fix:
 * - Unmemoized: Poor performance (all rows re-render)
 * - Memoized: Excellent performance (only changed rows re-render)
 */

// --- Data Generation (Krauset-style) ---

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

interface AppState {
  data: RowData[]
  selected: number | null
}

const buildData = (count: number): RowData[] => {
  const data: RowData[] = new Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${
        colours[_random(colours.length)]
      } ${nouns[_random(nouns.length)]}`,
    }
  }
  return data
}

// --- Component Implementations ---

// Unmemoized Row (all rows re-render on parent changes)
const UnmemoizedRow: FC<{
  item: RowData
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}> = ({ item, isSelected, onSelect, onRemove }) => {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item.id)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => onRemove(item.id)}>
          <span className="glyphicon glyphicon-remove" aria-hidden="true" />
        </a>
      </td>
      <td className="col-md-6" />
    </tr>
  )
}

// Memoized Row (only re-renders when props actually change)
// Thanks to proxy reference stability fix, React.memo works perfectly!
const MemoizedRow: FC<{
  item: RowData
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}> = memo(({ item, isSelected, onSelect, onRemove }) => {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item.id)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => onRemove(item.id)}>
          <span className="glyphicon glyphicon-remove" aria-hidden="true" />
        </a>
      </td>
      <td className="col-md-6" />
    </tr>
  )
})

// App with Unmemoized Rows
const UnmemoizedApp: FC<{
  store: any
  updateStore: any
}> = ({ store, updateStore }) => {
  const state = useTrackedStore(store)

  const select = (id: number) => updateStore({ $set: { selected: id } })
  const remove = (id: number) => updateStore({ $pull: { data: { id } } })

  return (
    <table>
      <tbody>
        {state.data.map((item: RowData) => (
          <UnmemoizedRow
            key={item.id}
            item={item}
            isSelected={state.selected === item.id}
            onSelect={select}
            onRemove={remove}
          />
        ))}
      </tbody>
    </table>
  )
}

// App with Memoized Rows and Stable Callbacks
const MemoizedApp: FC<{
  store: any
  updateStore: any
}> = ({ store, updateStore }) => {
  const state = useTrackedStore(store)

  // Stable callbacks prevent unnecessary re-renders
  const select = useCallback(
    (id: number) => updateStore({ $set: { selected: id } }),
    [updateStore]
  )
  const remove = useCallback(
    (id: number) => updateStore({ $pull: { data: { id } } }),
    [updateStore]
  )

  return (
    <table>
      <tbody>
        {state.data.map((item: RowData) => (
          <MemoizedRow
            key={item.id}
            item={item} // ← Stable proxy reference enables React.memo!
            isSelected={state.selected === item.id}
            onSelect={select}
            onRemove={remove}
          />
        ))}
      </tbody>
    </table>
  )
}

// --- Benchmark Suite ---

describe('Krauset-style Memoization Benchmarks', () => {
  // ==============================================================
  // CREATE 1000 ROWS - Initial Render Performance
  // ==============================================================

  bench(
    'create 1000 rows (unmemoized)',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<UnmemoizedApp store={store} updateStore={updateStore} />)
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  bench(
    'create 1000 rows (memoized)',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<MemoizedApp store={store} updateStore={updateStore} />)
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  // ==============================================================
  // SELECT ROW - Single Item Selection Performance
  // This is where memoization shows massive benefits
  // ==============================================================

  bench(
    'select row (unmemoized) - all 1000 rows re-render',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <UnmemoizedApp store={store} updateStore={updateStore} />
      )

      // Select row 500 - this causes ALL rows to re-render
      act(() => {
        updateStore({ $set: { selected: data[500].id } })
      })

      // Verify selection worked
      const selectedRow = container.querySelector('tbody tr:nth-child(501)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  bench(
    'select row (memoized) - only 1 row re-renders',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      const { container } = render(
        <MemoizedApp store={store} updateStore={updateStore} />
      )

      // Select row 500 - only this row re-renders thanks to memoization!
      act(() => {
        updateStore({ $set: { selected: data[500].id } })
      })

      // Verify selection worked
      const selectedRow = container.querySelector('tbody tr:nth-child(501)')
      if (!selectedRow?.classList.contains('danger')) {
        throw new Error('Row selection failed')
      }
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  // ==============================================================
  // UPDATE EVERY 10TH ROW - Partial Update Performance
  // ==============================================================

  bench(
    'update every 10th row (unmemoized) - all rows re-render',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<UnmemoizedApp store={store} updateStore={updateStore} />)

      // Update every 10th row (100 rows total)
      const updates: Record<string, string> = {}
      for (let i = 0; i < data.length; i += 10) {
        updates[`data.${i}.label`] = data[i].label + ' !!!'
      }

      act(() => {
        updateStore({ $set: updates })
      })
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  bench(
    'update every 10th row (memoized) - only 100 rows re-render',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<MemoizedApp store={store} updateStore={updateStore} />)

      // Update every 10th row (100 rows total)
      // With memoization, only the changed 100 rows re-render
      const updates: Record<string, string> = {}
      for (let i = 0; i < data.length; i += 10) {
        updates[`data.${i}.label`] = data[i].label + ' !!!'
      }

      act(() => {
        updateStore({ $set: updates })
      })
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  // ==============================================================
  // SWAP ROWS - Minimal Update Performance
  // ==============================================================

  bench(
    'swap 2 rows (unmemoized) - all 1000 rows re-render',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<UnmemoizedApp store={store} updateStore={updateStore} />)

      // Swap rows 1 and 998 - only 2 rows actually changed
      const row1 = data[1]
      const row998 = data[998]

      act(() => {
        updateStore({
          $set: {
            'data.1': row998,
            'data.998': row1,
          },
        })
      })
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  bench(
    'swap 2 rows (memoized) - only 2 rows re-render',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<MemoizedApp store={store} updateStore={updateStore} />)

      // Swap rows 1 and 998 - with memoization, only these 2 rows re-render
      const row1 = data[1]
      const row998 = data[998]

      act(() => {
        updateStore({
          $set: {
            'data.1': row998,
            'data.998': row1,
          },
        })
      })
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  // ==============================================================
  // REMOVE ROW - Single Item Removal Performance
  // ==============================================================

  bench(
    'remove 1 row (unmemoized) - all remaining rows re-render',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<UnmemoizedApp store={store} updateStore={updateStore} />)

      // Remove row 500
      act(() => {
        updateStore({ $pull: { data: { id: data[500].id } } })
      })
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  bench(
    'remove 1 row (memoized) - minimal re-renders',
    () => {
      const data = buildData(1000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<MemoizedApp store={store} updateStore={updateStore} />)

      // Remove row 500 - with memoization, minimal re-renders
      act(() => {
        updateStore({ $pull: { data: { id: data[500].id } } })
      })
    },
    {
      warmupIterations: 3,
      iterations: 20,
    }
  )

  // ==============================================================
  // LARGE DATASET - 10,000 Rows Performance
  // ==============================================================

  bench(
    'select row in 10k dataset (unmemoized) - all 10k rows re-render',
    () => {
      const data = buildData(10000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<UnmemoizedApp store={store} updateStore={updateStore} />)

      // Select a row in the middle
      act(() => {
        updateStore({ $set: { selected: data[5000].id } })
      })
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )

  bench(
    'select row in 10k dataset (memoized) - only 1 row re-renders',
    () => {
      const data = buildData(10000)
      const [store, updateStore] = createStore<AppState>({
        data,
        selected: null,
      })

      render(<MemoizedApp store={store} updateStore={updateStore} />)

      // Select a row in the middle - massive performance difference!
      act(() => {
        updateStore({ $set: { selected: data[5000].id } })
      })
    },
    {
      warmupIterations: 2,
      iterations: 5,
    }
  )
})
