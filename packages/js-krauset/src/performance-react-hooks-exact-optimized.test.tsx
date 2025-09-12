import { describe, it, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import {
  buildData,
  store,
  updateStore,
  App,
} from './main-react-hooks-exact-optimized'

// Helper function to measure performance with async completion
async function measureTimeAsync(name: string, fn: () => void): Promise<number> {
  const start = performance.now()
  fn()
  await waitForRender()
  const end = performance.now()
  const duration = end - start
  console.log(`${name}: ${duration.toFixed(2)}ms`)
  return duration
}

// Helper to wait for React to finish rendering
function waitForRender(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 16)
      })
    })
  })
}

describe('React-Hooks-Exact-Optimized Performance Tests', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(async () => {
    // Create DOM container
    container = document.createElement('div')
    container.innerHTML = '<table><tbody id="tbody"></tbody></table>'
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)

    // Create React root
    const tbody = container.querySelector('#tbody')!
    root = createRoot(tbody)

    // Initialize app to set up globalDispatch
    root.render(<App />)
    await waitForRender()

    // Clear store
    updateStore({ $set: { data: [], selected: null } })
    await waitForRender()
  })

  afterEach(() => {
    if (root) {
      root.unmount()
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  it('should measure creating 1K rows', async () => {
    console.log('\n=== REACT-HOOKS-EXACT-OPTIMIZED: CREATE 1K ROWS ===')

    const data = buildData(1000)
    const duration = await measureTimeAsync('Create 1K rows', () => {
      updateStore({
        $set: {
          data,
          selected: null,
        },
      })
      root.render(<App />)
    })

    // Verify rows were created
    const rows = container.querySelectorAll('tbody tr')
    console.log(`Rendered ${rows.length} rows`)

    console.log(`\nRESULT: Creating 1K rows took ${duration.toFixed(2)}ms\n`)
  })

  it('should measure creating 10K rows', async () => {
    console.log('\n=== REACT-HOOKS-EXACT-OPTIMIZED: CREATE 10K ROWS ===')

    const data = buildData(10000)
    const duration = await measureTimeAsync('Create 10K rows', () => {
      updateStore({
        $set: {
          data,
          selected: null,
        },
      })
      root.render(<App />)
    })

    // Verify rows were created
    const rows = container.querySelectorAll('tbody tr')
    console.log(`Rendered ${rows.length} rows`)

    console.log(`\nRESULT: Creating 10K rows took ${duration.toFixed(2)}ms\n`)
  })

  it('should measure updating every 10th row', async () => {
    console.log('\n=== REACT-HOOKS-EXACT-OPTIMIZED: UPDATE EVERY 10TH ROW ===')

    // First create 1K rows
    const data = buildData(1000)
    updateStore({
      $set: {
        data,
        selected: null,
      },
    })
    root.render(<App />)
    await waitForRender()

    console.log('Initial render complete, now measuring update...')

    const duration = await measureTimeAsync('Update every 10th row', () => {
      const updates: Record<string, string> = {}
      for (let i = 0; i < store.data.length; i += 10) {
        updates[`data.${i}.label`] = store.data[i].label + ' !!!'
      }
      updateStore({ $set: updates })
    })

    // Verify updates were applied
    const updatedRows = Array.from(
      container.querySelectorAll('tbody tr')
    ).filter((row, index) => {
      if (index % 10 === 0) {
        const labelCell = row.querySelector('td:nth-child(2) a')
        return labelCell?.textContent?.includes('!!!')
      }
      return false
    })
    console.log(`Updated ${updatedRows.length} rows (every 10th)`)

    console.log(
      `\nRESULT: Updating every 10th row took ${duration.toFixed(2)}ms\n`
    )
  })

  it('should measure swapping rows', async () => {
    console.log('\n=== REACT-HOOKS-EXACT-OPTIMIZED: SWAP ROWS ===')

    // First create 1K rows
    const data = buildData(1000)
    updateStore({
      $set: {
        data,
        selected: null,
      },
    })
    root.render(<App />)
    await waitForRender()

    console.log('Initial render complete, now measuring swap...')

    // Get original labels for verification
    const originalRow1Label = store.data[1].label
    const originalRow998Label = store.data[998].label

    const duration = await measureTimeAsync('Swap rows 1 and 998', () => {
      const row1 = store.data[1]
      const row998 = store.data[998]
      updateStore({
        $set: {
          'data.1': row998,
          'data.998': row1,
        },
      })
    })

    // Verify swap occurred
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
    console.log(`Row 1 now shows: ${row1Cell?.textContent}`)
    console.log(`Row 998 now shows: ${row998Cell?.textContent}`)

    console.log(`\nRESULT: Swapping 2 rows took ${duration.toFixed(2)}ms\n`)
  })

  it('should measure selecting a row', async () => {
    console.log('\n=== REACT-HOOKS-EXACT-OPTIMIZED: SELECT ROW ===')

    // First create 1K rows
    const data = buildData(1000)
    updateStore({
      $set: {
        data,
        selected: null,
      },
    })
    root.render(<App />)
    await waitForRender()

    console.log('Initial render complete, now measuring selection...')

    const targetId = data[500].id

    const duration = await measureTimeAsync('Select row 500', () => {
      updateStore({ $set: { selected: targetId } })
    })

    // Verify selection
    const selectedRows = container.querySelectorAll('tbody tr.danger')
    const selectedRowId =
      selectedRows[0]?.querySelector('td:first-child')?.textContent

    console.log(`Selected rows: ${selectedRows.length}`)
    console.log(`Selected row ID: ${selectedRowId}`)
    console.log(`Target ID: ${targetId}`)

    console.log(`\nRESULT: Selecting 1 row took ${duration.toFixed(2)}ms\n`)
  })

  it('should run complete performance suite', async () => {
    console.log('\n🚀 REACT-HOOKS-EXACT-OPTIMIZED PERFORMANCE SUITE RESULTS 🚀')
    console.log('==========================================================')

    const results: Record<string, number> = {}

    // Test 1: Create 1K rows
    const data1k = buildData(1000)
    const create1k = await measureTimeAsync('Creating 1K rows', () => {
      updateStore({
        $set: { data: data1k, selected: null },
      })
      root.render(<App />)
    })
    results['create_1k'] = create1k

    // Test 2: Select a row
    const select = await measureTimeAsync('Selecting row', () => {
      updateStore({ $set: { selected: store.data[500].id } })
    })
    results['select'] = select

    // Test 3: Update every 10th row
    const update = await measureTimeAsync('Updating every 10th row', () => {
      const updates: Record<string, string> = {}
      for (let i = 0; i < store.data.length; i += 10) {
        updates[`data.${i}.label`] = store.data[i].label + ' !!!'
      }
      updateStore({ $set: updates })
    })
    results['update'] = update

    // Test 4: Swap rows
    const swap = await measureTimeAsync('Swapping rows', () => {
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

    // Reset and test 10K rows
    updateStore({ $set: { data: [], selected: null } })
    await waitForRender()

    const data10k = buildData(10000)
    const create10k = await measureTimeAsync('Creating 10K rows', () => {
      updateStore({
        $set: { data: data10k, selected: null },
      })
    })
    results['create_10k'] = create10k

    // Final summary
    console.log('\n📊 REACT-HOOKS-EXACT-OPTIMIZED PERFORMANCE SUMMARY')
    console.log('==================================================')
    console.log(`Create 1K rows:     ${results.create_1k.toFixed(2)}ms`)
    console.log(`Create 10K rows:    ${results.create_10k.toFixed(2)}ms`)
    console.log(`Select row:         ${results.select.toFixed(2)}ms`)
    console.log(`Update (every 10th): ${results.update.toFixed(2)}ms`)
    console.log(`Swap 2 rows:        ${results.swap.toFixed(2)}ms`)
    console.log('==================================================')

    const total = Object.values(results).reduce((sum, val) => sum + val, 0)
    console.log(`Total time:         ${total.toFixed(2)}ms`)
    console.log(
      `Average per op:     ${(total / Object.keys(results).length).toFixed(
        2
      )}ms`
    )
  })
})
