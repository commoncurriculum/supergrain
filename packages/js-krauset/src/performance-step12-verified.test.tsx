import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createRoot } from 'react-dom/client'
import {
  buildData,
  store,
  updateStore,
  App,
} from './main-react-hooks-step12-fixed'

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

describe('Step 12 Imperative Performance + Verification Tests', () => {
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

    // Render app first to initialize globalDispatch, then clear store
    root.render(<App />)
    await waitForRender()
    updateStore({ $set: { data: [], selected: null } })
  })

  afterEach(() => {
    if (root) {
      root.unmount()
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  it('should work correctly AND be fast with imperative updates', async () => {
    console.log('\n🚀 STEP 12 PERFORMANCE + VERIFICATION TEST 🚀')
    console.log('==============================================')
    console.log('Testing both correctness AND performance!')

    // Test 1: Create 1K rows and verify they render
    const data1k = buildData(1000)
    const create1k = await measureTimeAsync('Creating 1K rows', () => {
      updateStore({
        $set: { data: data1k, selected: null },
      })
    })

    // ✅ VERIFY: Check that all rows are rendered
    const rows = container.querySelectorAll('tbody tr')
    expect(rows.length).toBe(1000)
    console.log(`✅ Rendered ${rows.length} rows correctly`)

    // ✅ VERIFY: Check first row content
    const firstRow = rows[0]
    const firstRowCells = firstRow.querySelectorAll('td')
    expect(firstRowCells[0].textContent).toBe(data1k[0].id.toString())
    expect(firstRowCells[1].textContent).toBe(data1k[0].label)
    console.log(
      `✅ First row content: ID=${firstRowCells[0].textContent}, Label="${firstRowCells[1].textContent}"`
    )

    // Test 2: Select a row and verify selection works
    const targetId = data1k[500].id
    const select = await measureTimeAsync('Selecting row (imperative)', () => {
      updateStore({ $set: { selected: targetId } })
    })

    // ✅ VERIFY: Check that exactly one row is selected
    const selectedRows = container.querySelectorAll('tbody tr.danger')
    expect(selectedRows.length).toBe(1)

    // ✅ VERIFY: Check that the correct row is selected
    const selectedRowId =
      selectedRows[0].querySelector('td:first-child')?.textContent
    expect(selectedRowId).toBe(targetId.toString())
    console.log(
      `✅ Selected row ${selectedRowId} correctly (expected ${targetId})`
    )

    // Test 3: Update every 10th row and verify updates work
    const update = await measureTimeAsync(
      'Updating every 10th row (imperative)',
      () => {
        const updates: Record<string, string> = {}
        for (let i = 0; i < store.data.length; i += 10) {
          updates[`data.${i}.label`] = store.data[i].label + ' !!!'
        }
        updateStore({ $set: updates })
      }
    )

    // ✅ VERIFY: Check that every 10th row was updated
    let updatedCount = 0
    Array.from(rows).forEach((row, index) => {
      if (index % 10 === 0) {
        const labelCell = row.querySelector('td:nth-child(2) a')
        if (labelCell?.textContent?.includes('!!!')) {
          updatedCount++
        }
      }
    })
    expect(updatedCount).toBe(100) // 1000 / 10 = 100 rows should be updated
    console.log(`✅ Updated ${updatedCount} rows (every 10th) correctly`)

    // Test 4: Swap rows and verify swap works
    const originalRow1Label =
      rows[1].querySelector('td:nth-child(2) a')?.textContent
    const originalRow998Label =
      rows[998].querySelector('td:nth-child(2) a')?.textContent

    const swap = await measureTimeAsync('Swapping rows (imperative)', () => {
      const row1 = store.data[1]
      const row998 = store.data[998]
      updateStore({
        $set: {
          'data.1': row998,
          'data.998': row1,
        },
      })
    })

    // ✅ VERIFY: Check that rows were swapped
    await waitForRender() // Give time for imperative updates
    const newRow1Label = rows[1].querySelector('td:nth-child(2) a')?.textContent
    const newRow998Label =
      rows[998].querySelector('td:nth-child(2) a')?.textContent

    expect(newRow1Label).toBe(originalRow998Label)
    expect(newRow998Label).toBe(originalRow1Label)
    console.log(
      `✅ Swapped rows correctly: Row1="${newRow1Label}" <-> Row998="${newRow998Label}"`
    )

    // Performance Summary
    const total = create1k + select + update + swap
    console.log('\n📊 PERFORMANCE SUMMARY')
    console.log('=======================')
    console.log(`Create 1K rows:      ${create1k.toFixed(2)}ms`)
    console.log(`Select row:          ${select.toFixed(2)}ms ⚡ IMPERATIVE`)
    console.log(`Update every 10th:   ${update.toFixed(2)}ms ⚡ IMPERATIVE`)
    console.log(`Swap 2 rows:         ${swap.toFixed(2)}ms ⚡ IMPERATIVE`)
    console.log('=======================')
    console.log(`Total time:          ${total.toFixed(2)}ms`)

    console.log('\n🎯 VERIFICATION PASSED!')
    console.log('- All 1000 rows rendered correctly')
    console.log('- Row selection works imperatively')
    console.log('- Partial updates work (100 rows updated)')
    console.log('- Row swapping works imperatively')
    console.log('- DOM reflects all state changes')

    if (total < 841.0) {
      console.log(
        `\n🚀 CHAMPION PERFORMANCE: ${(((841.0 - total) / 841.0) * 100).toFixed(
          1
        )}% faster than useMemo approach!`
      )
    }
  })
})
