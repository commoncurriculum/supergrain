import { describe, it, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { buildData, store, updateStore, App } from './main-react-hooks-step1'

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

describe('React-Hooks Step 1 Performance Tests (Baseline)', () => {
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

  it('should run performance suite - BASELINE (exact js-framework-benchmark)', async () => {
    console.log('\n🚀 REACT-HOOKS STEP 1 (BASELINE) PERFORMANCE RESULTS 🚀')
    console.log('=====================================================')

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
    console.log('\n📊 STEP 1 (BASELINE) PERFORMANCE SUMMARY')
    console.log('========================================')
    console.log(`Create 1K rows:     ${results.create_1k.toFixed(2)}ms`)
    console.log(`Create 10K rows:    ${results.create_10k.toFixed(2)}ms`)
    console.log(`Select row:         ${results.select.toFixed(2)}ms`)
    console.log(`Update (every 10th): ${results.update.toFixed(2)}ms`)
    console.log(`Swap 2 rows:        ${results.swap.toFixed(2)}ms`)
    console.log('========================================')

    const total = Object.values(results).reduce((sum, val) => sum + val, 0)
    console.log(`BASELINE TOTAL:     ${total.toFixed(2)}ms`)
    console.log('========================================')
  })
})
