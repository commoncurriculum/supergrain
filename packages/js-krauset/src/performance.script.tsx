import { createRoot } from 'react-dom/client'
import { createStore } from '@storable/core'
import { useTrackedStore, For } from '@storable/react'
import { FC, memo, useCallback } from 'react'

// Import the exact same data generation and store logic from main.tsx
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
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
const colours = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
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
  'pizza',
  'mouse',
  'keyboard',
]

function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max
}

function buildData(count: number): RowData[] {
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

interface RowData {
  id: number
  label: string
}

interface AppState {
  data: RowData[]
  selected: number | null
}

interface RowProps {
  item: RowData
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}

// Use the exact same Row component from main.tsx
const Row: FC<RowProps> = memo(({ item, isSelected, onSelect, onRemove }) => {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item.id)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => onRemove(item.id)}>
          <span
            className="glyphicon glyphicon-remove"
            aria-hidden="true"
          ></span>
        </a>
      </td>
      <td className="col-md-6"></td>
    </tr>
  )
})

// Use the exact same App component from main.tsx
const App: FC<{ store: any; updateStore: any }> = ({ store, updateStore }) => {
  const state = useTrackedStore(store)

  const handleSelect = useCallback(
    (id: number) => {
      updateStore({ $set: { selected: id } })
    },
    [updateStore]
  )

  const handleRemove = useCallback(
    (id: number) => {
      updateStore({ $pull: { data: { id } } })
    },
    [updateStore]
  )

  return (
    <>
      <For each={state.data}>
        {(item: RowData) => (
          <Row
            key={item.id}
            item={item}
            isSelected={state.selected === item.id}
            onSelect={handleSelect}
            onRemove={handleRemove}
          />
        )}
      </For>
    </>
  )
}

// Helper function to measure performance
function measureTime(name: string, fn: () => void): number {
  const start = performance.now()
  fn()
  const end = performance.now()
  const duration = end - start
  console.log(`${name}: ${duration.toFixed(2)}ms`)
  return duration
}

// Helper to wait for React to finish rendering
function waitForRender(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}

// Main performance runner function
async function runPerformanceBenchmarks() {
  console.log('\n🚀 KRAUSET PERFORMANCE SUITE 🚀')
  console.log('====================================')

  // Reset idCounter for consistent results
  idCounter = 1

  // Create DOM container
  const container = document.createElement('div')
  container.innerHTML = '<table><tbody id="tbody"></tbody></table>'
  document.body.appendChild(container)

  // Create store
  const [store, updateStore] = createStore<AppState>({
    data: [],
    selected: null,
  })

  // Create React root
  const tbody = container.querySelector('#tbody')!
  const root = createRoot(tbody)

  const results: Record<string, number> = {}

  try {
    // Test 1: Create 1K rows
    console.log('\n=== CREATE 1K ROWS ===')
    const create1k = measureTime('Creating 1K rows', () => {
      const data = buildData(1000)
      updateStore({
        $set: { data, selected: null },
      })
      root.render(<App store={store} updateStore={updateStore} />)
    })
    results['create_1k'] = create1k
    await waitForRender()
    console.log(
      `Rendered ${container.querySelectorAll('tbody tr').length} rows`
    )

    // Test 2: Select a row
    console.log('\n=== SELECT ROW ===')
    const select = measureTime('Selecting row 500', () => {
      updateStore({ $set: { selected: store.data[500].id } })
    })
    results['select'] = select
    await waitForRender()
    console.log(
      `Selected rows: ${container.querySelectorAll('tbody tr.danger').length}`
    )

    // Test 3: Update every 10th row
    console.log('\n=== UPDATE EVERY 10TH ROW ===')
    const update = measureTime('Updating every 10th row', () => {
      const updates: Record<string, string> = {}
      for (let i = 0; i < store.data.length; i += 10) {
        updates[`data.${i}.label`] = store.data[i].label + ' !!!'
      }
      updateStore({ $set: updates })
    })
    results['update'] = update
    await waitForRender()

    const updatedCount = Array.from(
      container.querySelectorAll('tbody tr')
    ).filter((row, index) => {
      if (index % 10 === 0) {
        const labelCell = row.querySelector('td:nth-child(2) a')
        return labelCell?.textContent?.includes('!!!')
      }
      return false
    }).length
    console.log(`Updated ${updatedCount} rows`)

    // Test 4: Swap rows
    console.log('\n=== SWAP ROWS ===')
    const originalRow1Label = store.data[1].label
    const originalRow998Label = store.data[998].label

    const swap = measureTime('Swapping rows 1 and 998', () => {
      const row1 = store.data[1]
      const row998 = store.data[998]
      updateStore({
        $set: {
          'data.1': row998,
          'data.998': row1,
        },
      })
    })
    results['swap'] = swap
    await waitForRender()

    const row1Cell = container.querySelector(
      'tbody tr:nth-child(2) td:nth-child(2) a'
    )
    const row998Cell = container.querySelector(
      'tbody tr:nth-child(999) td:nth-child(2) a'
    )
    const swapSuccessful =
      row1Cell?.textContent === originalRow998Label &&
      row998Cell?.textContent === originalRow1Label
    console.log(`Swap successful: ${swapSuccessful}`)

    // Reset and test 10K rows
    console.log('\n=== CREATE 10K ROWS ===')
    updateStore({ $set: { data: [], selected: null } })
    await waitForRender()

    const create10k = measureTime('Creating 10K rows', () => {
      const data = buildData(10000)
      updateStore({
        $set: { data, selected: null },
      })
    })
    results['create_10k'] = create10k
    await waitForRender()
    console.log(
      `Rendered ${container.querySelectorAll('tbody tr').length} rows`
    )

    // Final summary
    console.log('\n📊 PERFORMANCE SUMMARY')
    console.log('=====================')
    console.log(`Create 1K rows:      ${results.create_1k.toFixed(2)}ms`)
    console.log(`Create 10K rows:     ${results.create_10k.toFixed(2)}ms`)
    console.log(`Select row:          ${results.select.toFixed(2)}ms`)
    console.log(`Update (every 10th): ${results.update.toFixed(2)}ms`)
    console.log(`Swap 2 rows:         ${results.swap.toFixed(2)}ms`)
    console.log('=====================')

    const total = Object.values(results).reduce((sum, val) => sum + val, 0)
    console.log(`Total time:          ${total.toFixed(2)}ms`)
    console.log(
      `Average per op:      ${(total / Object.keys(results).length).toFixed(
        2
      )}ms`
    )
  } finally {
    // Cleanup
    root.unmount()
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  }

  return results
}

// Auto-run when script is loaded
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runPerformanceBenchmarks)
  } else {
    runPerformanceBenchmarks()
  }
}

// Export for manual usage
export { runPerformanceBenchmarks }
