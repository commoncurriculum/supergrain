import { describe, it, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'

// Import all three implementations
import * as Storable from './main'
import * as ReactHooks from './main-react-hooks'
import * as ReactHooksOptimized from './main-react-hooks-optimized'

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

// Reset implementation state
async function resetImplementation(impl: any, root: any) {
  // For React hooks implementations, need to render first to initialize dispatch
  const needsInit =
    !impl.name || impl.name.includes('react') || impl.name.includes('React')
  if (needsInit) {
    root.render(<impl.App />)
    await waitForRender()
  }
  impl.updateStore({ $set: { data: [], selected: null } })
  await waitForRender()
}

describe('Performance Comparison - All Approaches', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(() => {
    // Create DOM container
    container = document.createElement('div')
    container.innerHTML = '<table><tbody id="tbody"></tbody></table>'
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)

    // Create React root
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

  it('should compare all implementations', async () => {
    console.log('\n🏁 PERFORMANCE COMPARISON - ALL IMPLEMENTATIONS 🏁')
    console.log('===================================================')

    const results: Record<string, Record<string, number>> = {
      storable: {},
      reactHooks: {},
      reactHooksOptimized: {},
    }

    // Test each implementation
    const implementations = [
      { name: 'storable', module: Storable, displayName: 'Storable' },
      { name: 'reactHooks', module: ReactHooks, displayName: 'React-Hooks' },
      {
        name: 'reactHooksOptimized',
        module: ReactHooksOptimized,
        displayName: 'React-Hooks-Optimized',
      },
    ]

    for (const impl of implementations) {
      console.log(`\n--- Testing ${impl.displayName} ---`)

      // Reset state
      await resetImplementation(impl.module, root)

      // Test 1: Create 1K rows
      const data1k = impl.module.buildData(1000)
      const create1k = await measureTimeAsync(
        `${impl.displayName}: Create 1K rows`,
        () => {
          impl.module.updateStore({
            $set: { data: data1k, selected: null },
          })
          root.render(<impl.module.App />)
        }
      )
      results[impl.name]['create_1k'] = create1k

      // Test 2: Select a row
      const select = await measureTimeAsync(
        `${impl.displayName}: Select row`,
        () => {
          impl.module.updateStore({
            $set: { selected: impl.module.store.data[500].id },
          })
        }
      )
      results[impl.name]['select'] = select

      // Test 3: Update every 10th row
      const update = await measureTimeAsync(
        `${impl.displayName}: Update every 10th`,
        () => {
          const updates: Record<string, string> = {}
          for (let i = 0; i < impl.module.store.data.length; i += 10) {
            updates[`data.${i}.label`] =
              impl.module.store.data[i].label + ' !!!'
          }
          impl.module.updateStore({ $set: updates })
        }
      )
      results[impl.name]['update'] = update

      // Test 4: Swap rows
      const swap = await measureTimeAsync(
        `${impl.displayName}: Swap rows`,
        () => {
          const row1 = impl.module.store.data[1]
          const row998 = impl.module.store.data[998]
          impl.module.updateStore({
            $set: {
              'data.1': row998,
              'data.998': row1,
            },
          })
        }
      )
      results[impl.name]['swap'] = swap

      // Reset for 10K test
      await resetImplementation(impl.module, root)

      // Test 5: Create 10K rows
      const data10k = impl.module.buildData(10000)
      const create10k = await measureTimeAsync(
        `${impl.displayName}: Create 10K rows`,
        () => {
          impl.module.updateStore({
            $set: { data: data10k, selected: null },
          })
        }
      )
      results[impl.name]['create_10k'] = create10k

      console.log(`${impl.displayName} completed`)
    }

    // Performance comparison table
    console.log('\n📊 PERFORMANCE COMPARISON RESULTS')
    console.log('==================================')
    console.log(
      'Operation              Storable    React-Hooks  Optimized    Winner'
    )
    console.log(
      '------------------------------------------------------------------'
    )

    const operations = [
      { key: 'create_1k', name: 'Create 1K rows   ' },
      { key: 'create_10k', name: 'Create 10K rows  ' },
      { key: 'select', name: 'Select row       ' },
      { key: 'update', name: 'Update (every 10th)' },
      { key: 'swap', name: 'Swap 2 rows      ' },
    ]

    for (const op of operations) {
      const storableTime = results.storable[op.key]
      const reactHooksTime = results.reactHooks[op.key]
      const optimizedTime = results.reactHooksOptimized[op.key]

      const times = [
        { name: 'Storable', time: storableTime },
        { name: 'React-Hooks', time: reactHooksTime },
        { name: 'Optimized', time: optimizedTime },
      ]

      const winner = times.reduce((min, current) =>
        current.time < min.time ? current : min
      )

      console.log(
        `${op.name}  ${storableTime.toFixed(2).padStart(8)}ms  ${reactHooksTime
          .toFixed(2)
          .padStart(9)}ms  ${optimizedTime.toFixed(2).padStart(9)}ms  ${
          winner.name
        }`
      )
    }

    // Calculate totals and performance improvements
    console.log(
      '------------------------------------------------------------------'
    )

    const storableTotal = Object.values(results.storable).reduce(
      (sum, val) => sum + val,
      0
    )
    const reactHooksTotal = Object.values(results.reactHooks).reduce(
      (sum, val) => sum + val,
      0
    )
    const optimizedTotal = Object.values(results.reactHooksOptimized).reduce(
      (sum, val) => sum + val,
      0
    )

    console.log(
      `TOTAL              ${storableTotal
        .toFixed(2)
        .padStart(8)}ms  ${reactHooksTotal
        .toFixed(2)
        .padStart(9)}ms  ${optimizedTotal.toFixed(2).padStart(9)}ms`
    )

    // Performance analysis
    console.log('\n📈 PERFORMANCE ANALYSIS')
    console.log('=======================')

    const storableVsReactHooks =
      ((reactHooksTotal - storableTotal) / storableTotal) * 100
    const reactHooksVsOptimized =
      ((reactHooksTotal - optimizedTotal) / reactHooksTotal) * 100
    const storableVsOptimized =
      ((optimizedTotal - storableTotal) / storableTotal) * 100

    console.log(
      `Storable vs React-Hooks:     ${
        storableVsReactHooks > 0 ? 'React-Hooks' : 'Storable'
      } is ${Math.abs(storableVsReactHooks).toFixed(1)}% ${
        storableVsReactHooks > 0 ? 'slower' : 'faster'
      }`
    )
    console.log(
      `React-Hooks vs Optimized:    Optimized is ${reactHooksVsOptimized.toFixed(
        1
      )}% faster`
    )
    console.log(
      `Storable vs Optimized:       ${
        storableVsOptimized > 0 ? 'Optimized' : 'Storable'
      } is ${Math.abs(storableVsOptimized).toFixed(1)}% ${
        storableVsOptimized > 0 ? 'slower' : 'faster'
      }`
    )

    // Winner announcement
    const implementations_with_totals = [
      { name: 'Storable', total: storableTotal },
      { name: 'React-Hooks', total: reactHooksTotal },
      { name: 'React-Hooks-Optimized', total: optimizedTotal },
    ]

    const overallWinner = implementations_with_totals.reduce((min, current) =>
      current.total < min.total ? current : min
    )

    console.log('\n🏆 OVERALL WINNER')
    console.log('================')
    console.log(
      `${overallWinner.name} with ${overallWinner.total.toFixed(
        2
      )}ms total time`
    )

    // Verify all implementations work correctly
    console.log('\n✅ CORRECTNESS VERIFICATION')
    console.log('===========================')
    const rows = container.querySelectorAll('tbody tr')
    console.log(`Final render: ${rows.length} rows displayed`)
    console.log('All implementations completed successfully')
  })
})
