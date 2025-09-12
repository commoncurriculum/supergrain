import { describe, it, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'

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

describe('Step 13 vs Step 14 Performance Comparison', () => {
  let container: HTMLDivElement
  let root: any

  beforeEach(async () => {
    // Create DOM container
    container = document.createElement('div')
    container.innerHTML = '<table><tbody id="tbody"></tbody></table>'
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) {
      root.unmount()
    }
    if (container.parentNode) {
      container.parentNode.removeChild(container)
    }
  })

  it('should compare Step 13 (truly imperative) vs Step 14 (imperative no DOM)', async () => {
    console.log('\n🏆 FINAL IMPERATIVE APPROACHES COMPARISON')
    console.log('==========================================')

    // Test Step 13: Truly Imperative (direct DOM manipulation)
    console.log('\n🔥 STEP 13: Truly Imperative (Direct DOM Manipulation)')
    console.log('====================================================')

    const {
      run: run13,
      update: update13,
      select: select13,
      clear: clear13,
      App: App13,
      store: store13,
    } = await import('./main-react-hooks-step13-truly-imperative')

    // Create React root for Step 13
    const tbody13 = container.querySelector('#tbody')!
    root = createRoot(tbody13)
    root.render(<App13 />)
    await waitForRender()

    const results13: Record<string, number> = {}

    // Step 13 tests
    const create1k13 = await measureTimeAsync('Step 13: Create 1K rows', () => {
      run13(1000)
    })
    results13['create_1k'] = create1k13

    const select13Time = await measureTimeAsync('Step 13: Select row', () => {
      select13(store13.data[500].id)
    })
    results13['select'] = select13Time

    const update13Time = await measureTimeAsync(
      'Step 13: Update every 10th',
      () => {
        update13()
      }
    )
    results13['update'] = update13Time

    clear13()
    await waitForRender()

    const create10k13 = await measureTimeAsync(
      'Step 13: Create 10K rows',
      () => {
        run13(10000)
      }
    )
    results13['create_10k'] = create10k13

    const total13 = Object.values(results13).reduce((sum, val) => sum + val, 0)

    // Clean up
    root.unmount()
    container.innerHTML = '<table><tbody id="tbody"></tbody></table>'

    console.log(
      '\n⚡ STEP 14: Imperative (React Rendering + Imperative Updates)'
    )
    console.log('============================================================')

    // Test Step 14: Imperative No DOM
    const {
      run: run14,
      update: update14,
      select: select14,
      clear: clear14,
      App: App14,
      store: store14,
    } = await import('./main-react-hooks-step14-imperative-no-dom')

    // Create React root for Step 14
    const tbody14 = container.querySelector('#tbody')!
    root = createRoot(tbody14)
    root.render(<App14 />)
    await waitForRender()
    clear14()
    await waitForRender()

    const results14: Record<string, number> = {}

    // Step 14 tests
    const create1k14 = await measureTimeAsync('Step 14: Create 1K rows', () => {
      run14(1000)
    })
    results14['create_1k'] = create1k14

    const select14Time = await measureTimeAsync('Step 14: Select row', () => {
      select14(store14.data[500].id)
    })
    results14['select'] = select14Time

    const update14Time = await measureTimeAsync(
      'Step 14: Update every 10th',
      () => {
        update14()
      }
    )
    results14['update'] = update14Time

    clear14()
    await waitForRender()

    const create10k14 = await measureTimeAsync(
      'Step 14: Create 10K rows',
      () => {
        run14(10000)
      }
    )
    results14['create_10k'] = create10k14

    const total14 = Object.values(results14).reduce((sum, val) => sum + val, 0)

    // Final comparison
    console.log('\n📊 FINAL COMPARISON')
    console.log('==================')
    console.log('                           Step 13    Step 14    Difference')
    console.log('                           --------   --------   ----------')
    console.log(
      `Create 1K rows:           ${results13.create_1k.toFixed(
        2
      )}ms    ${results14.create_1k.toFixed(2)}ms     ${(
        ((results14.create_1k - results13.create_1k) / results13.create_1k) *
        100
      ).toFixed(1)}%`
    )
    console.log(
      `Create 10K rows:          ${results13.create_10k.toFixed(
        2
      )}ms   ${results14.create_10k.toFixed(2)}ms    ${(
        ((results14.create_10k - results13.create_10k) / results13.create_10k) *
        100
      ).toFixed(1)}%`
    )
    console.log(
      `Select row:               ${results13.select.toFixed(
        2
      )}ms     ${results14.select.toFixed(2)}ms      ${(
        ((results14.select - results13.select) / results13.select) *
        100
      ).toFixed(1)}%`
    )
    console.log(
      `Update (every 10th):      ${results13.update.toFixed(
        2
      )}ms     ${results14.update.toFixed(2)}ms      ${(
        ((results14.update - results13.update) / results13.update) *
        100
      ).toFixed(1)}%`
    )
    console.log(
      `TOTAL:                    ${total13.toFixed(2)}ms   ${total14.toFixed(
        2
      )}ms    ${(((total14 - total13) / total13) * 100).toFixed(1)}%`
    )

    console.log('\n🎯 KEY INSIGHTS')
    console.log('===============')
    if (total13 < total14) {
      console.log(
        `🚀 Step 13 (DOM manipulation) is ${(
          ((total14 - total13) / total14) *
          100
        ).toFixed(1)}% faster`
      )
      console.log('✅ Direct DOM manipulation provides significant speed gains')
      console.log('⚠️  But abandons React rendering system entirely')
    } else {
      console.log(
        `⚡ Step 14 (React + imperative) is ${(
          ((total13 - total14) / total13) *
          100
        ).toFixed(1)}% faster`
      )
      console.log(
        '✅ Best of both worlds: React rendering + imperative updates'
      )
    }

    console.log('\n🔬 TECHNICAL ANALYSIS')
    console.log('=====================')
    console.log('Step 13: Complete bypass of React (DOM manipulation)')
    console.log('  ✅ Maximum speed - no React overhead')
    console.log('  ❌ Abandons React ecosystem (DevTools, etc.)')
    console.log('  ❌ Difficult to maintain and integrate')
    console.log('')
    console.log(
      'Step 14: Hybrid approach (React rendering + imperative updates)'
    )
    console.log('  ✅ Uses React for rendering - maintains ecosystem benefits')
    console.log('  ✅ Imperative updates bypass reconciliation')
    console.log('  ✅ Signal-compatible architecture')
    console.log('  ✅ Maintainable and team-friendly')

    console.log('\n🏆 RECOMMENDATION')
    console.log('=================')
    console.log(
      'Step 14 provides the best balance of performance and maintainability'
    )
    console.log('Perfect foundation for signal-based fine-grained reactivity')
  })
})
