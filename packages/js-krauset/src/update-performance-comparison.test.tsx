import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createRoot } from 'react-dom/client'
import { buildData, store, updateStore, App } from './main-react-hooks-step8' // useMemo champion
import {
  buildData as buildDataImperative,
  store as storeImperative,
  updateStore as updateStoreImperative,
  App as AppImperative,
} from './main-react-hooks-step12-fixed' // Imperative approach
import {
  buildData as buildDataBaseline,
  store as storeBaseline,
  updateStore as updateStoreBaseline,
  App as AppBaseline,
} from './main-react-hooks-step1' // Original baseline

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

describe('UPDATE Performance Comparison: Focus on Updates Only', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(async () => {
    container = document.createElement('div')
    container.innerHTML = '<table><tbody id="tbody"></tbody></table>'
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)

    const tbody = container.querySelector('#tbody')!
    root = createRoot(tbody)
  })

  afterEach(() => {
    if (root) {
      root.unmount()
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  it('should compare FULL benchmark including 10K test', async () => {
    console.log('\n📊 FULL BENCHMARK COMPARISON (with 10K test)')
    console.log('==============================================')

    // Test 1: Original Baseline (Step 1)
    console.log('\n🔥 STEP 1: Original js-framework-benchmark (Baseline)')
    root.render(<AppBaseline />)
    await waitForRender()
    updateStoreBaseline({ $set: { data: [], selected: null } })

    const baselineResults: number[] = []

    // Create 1K
    baselineResults.push(
      await measureTimeAsync('Create 1K', () => {
        updateStoreBaseline({
          $set: { data: buildDataBaseline(1000), selected: null },
        })
      })
    )

    // Select
    baselineResults.push(
      await measureTimeAsync('Select row', () => {
        updateStoreBaseline({ $set: { selected: storeBaseline.data[500].id } })
      })
    )

    // Update every 10th
    const baselineUpdate = await measureTimeAsync('Update every 10th', () => {
      const updates: Record<string, string> = {}
      for (let i = 0; i < storeBaseline.data.length; i += 10) {
        updates[`data.${i}.label`] = storeBaseline.data[i].label + ' !!!'
      }
      updateStoreBaseline({ $set: updates })
    })
    baselineResults.push(baselineUpdate)

    // Swap
    const baselineSwap = await measureTimeAsync('Swap rows', () => {
      updateStoreBaseline({
        $set: {
          'data.1': storeBaseline.data[998],
          'data.998': storeBaseline.data[1],
        },
      })
    })
    baselineResults.push(baselineSwap)

    // Create 10K (the big one!)
    updateStoreBaseline({ $set: { data: [], selected: null } })
    await waitForRender()
    baselineResults.push(
      await measureTimeAsync('Create 10K', () => {
        updateStoreBaseline({
          $set: { data: buildDataBaseline(10000), selected: null },
        })
      })
    )

    const baselineTotal = baselineResults.reduce((sum, val) => sum + val, 0)
    console.log(`📊 BASELINE TOTAL: ${baselineTotal.toFixed(2)}ms`)

    // Test 2: useMemo Approach (Step 8)
    console.log('\n🏆 STEP 8: useMemo Approach')
    root.unmount()
    root = createRoot(container.querySelector('#tbody')!)
    root.render(<App />)
    await waitForRender()
    updateStore({ $set: { data: [], selected: null } })

    const useMemoResults: number[] = []

    useMemoResults.push(
      await measureTimeAsync('Create 1K', () => {
        updateStore({ $set: { data: buildData(1000), selected: null } })
      })
    )

    useMemoResults.push(
      await measureTimeAsync('Select row', () => {
        updateStore({ $set: { selected: store.data[500].id } })
      })
    )

    const useMemoUpdate = await measureTimeAsync('Update every 10th', () => {
      const updates: Record<string, string> = {}
      for (let i = 0; i < store.data.length; i += 10) {
        updates[`data.${i}.label`] = store.data[i].label + ' !!!'
      }
      updateStore({ $set: updates })
    })
    useMemoResults.push(useMemoUpdate)

    const useMemoSwap = await measureTimeAsync('Swap rows', () => {
      updateStore({
        $set: { 'data.1': store.data[998], 'data.998': store.data[1] },
      })
    })
    useMemoResults.push(useMemoSwap)

    updateStore({ $set: { data: [], selected: null } })
    await waitForRender()
    useMemoResults.push(
      await measureTimeAsync('Create 10K', () => {
        updateStore({ $set: { data: buildData(10000), selected: null } })
      })
    )

    const useMemoTotal = useMemoResults.reduce((sum, val) => sum + val, 0)
    console.log(`📊 USEMEMO TOTAL: ${useMemoTotal.toFixed(2)}ms`)

    // Test 3: Imperative Approach (Step 12)
    console.log('\n🚀 STEP 12: Imperative Approach')
    root.unmount()
    root = createRoot(container.querySelector('#tbody')!)
    root.render(<AppImperative />)
    await waitForRender()
    updateStoreImperative({ $set: { data: [], selected: null } })

    const imperativeResults: number[] = []

    imperativeResults.push(
      await measureTimeAsync('Create 1K', () => {
        updateStoreImperative({
          $set: { data: buildDataImperative(1000), selected: null },
        })
      })
    )

    imperativeResults.push(
      await measureTimeAsync('Select row (imperative)', () => {
        updateStoreImperative({
          $set: { selected: storeImperative.data[500].id },
        })
      })
    )

    const imperativeUpdate = await measureTimeAsync(
      'Update every 10th (imperative)',
      () => {
        const updates: Record<string, string> = {}
        for (let i = 0; i < storeImperative.data.length; i += 10) {
          updates[`data.${i}.label`] = storeImperative.data[i].label + ' !!!'
        }
        updateStoreImperative({ $set: updates })
      }
    )
    imperativeResults.push(imperativeUpdate)

    const imperativeSwap = await measureTimeAsync(
      'Swap rows (imperative)',
      () => {
        updateStoreImperative({
          $set: {
            'data.1': storeImperative.data[998],
            'data.998': storeImperative.data[1],
          },
        })
      }
    )
    imperativeResults.push(imperativeSwap)

    updateStoreImperative({ $set: { data: [], selected: null } })
    await waitForRender()
    imperativeResults.push(
      await measureTimeAsync('Create 10K', () => {
        updateStoreImperative({
          $set: { data: buildDataImperative(10000), selected: null },
        })
      })
    )

    const imperativeTotal = imperativeResults.reduce((sum, val) => sum + val, 0)
    console.log(`📊 IMPERATIVE TOTAL: ${imperativeTotal.toFixed(2)}ms`)

    // FOCUS: Update Performance Comparison
    console.log('\n🎯 UPDATE PERFORMANCE FOCUS')
    console.log('============================')
    console.log(`Baseline Update:     ${baselineUpdate.toFixed(2)}ms`)
    console.log(`useMemo Update:      ${useMemoUpdate.toFixed(2)}ms`)
    console.log(`Imperative Update:   ${imperativeUpdate.toFixed(2)}ms`)
    console.log('')
    console.log('UPDATE PERFORMANCE:')
    if (imperativeUpdate < useMemoUpdate) {
      console.log(
        `🚀 Imperative is ${(
          ((useMemoUpdate - imperativeUpdate) / useMemoUpdate) *
          100
        ).toFixed(1)}% faster for UPDATES`
      )
    } else {
      console.log(
        `📈 useMemo is ${(
          ((imperativeUpdate - useMemoUpdate) / imperativeUpdate) *
          100
        ).toFixed(1)}% faster for UPDATES`
      )
    }

    console.log('\nSWAP PERFORMANCE:')
    if (imperativeSwap < useMemoSwap) {
      console.log(
        `🚀 Imperative is ${(
          ((useMemoSwap - imperativeSwap) / useMemoSwap) *
          100
        ).toFixed(1)}% faster for SWAPS`
      )
    } else {
      console.log(
        `📈 useMemo is ${(
          ((imperativeSwap - useMemoSwap) / imperativeSwap) *
          100
        ).toFixed(1)}% faster for SWAPS`
      )
    }

    // Final Summary
    console.log('\n📊 COMPLETE BENCHMARK RESULTS')
    console.log('==============================')
    console.log(`Baseline (Step 1):   ${baselineTotal.toFixed(2)}ms`)
    console.log(`useMemo (Step 8):     ${useMemoTotal.toFixed(2)}ms`)
    console.log(`Imperative (Step 12): ${imperativeTotal.toFixed(2)}ms`)

    if (imperativeTotal < useMemoTotal) {
      console.log(
        `🚀 Imperative wins overall: ${(
          ((useMemoTotal - imperativeTotal) / useMemoTotal) *
          100
        ).toFixed(1)}% faster`
      )
    } else {
      console.log(
        `🏆 useMemo wins overall: ${(
          ((imperativeTotal - useMemoTotal) / imperativeTotal) *
          100
        ).toFixed(1)}% faster`
      )
    }

    expect(true).toBe(true) // Just to make the test pass
  })
})
