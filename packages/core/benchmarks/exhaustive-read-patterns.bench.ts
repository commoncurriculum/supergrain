/**
 * Exhaustive benchmark of every possible read pattern for reactive signals.
 *
 * Goal: find a read pattern faster than the proxy (~420 ops/s for 100k reads).
 * We know `nodes['title']()` cached locally hits ~4,100 ops/s (10x faster).
 * The question is whether any compiled pattern can approach that speed.
 */

import { bench, describe } from 'vitest'
import { createStore, readSignal, readLeaf, unwrap, $NODE, $RAW } from '../src'
import { effect, signal as alienSignal } from 'alien-signals'

// Shared setup
const [store] = createStore({ title: 'Buy milk' })
const raw = unwrap(store) as any

// Force signal creation by reading in a reactive context
const initDispose = effect(() => { store.title })
initDispose()

// Pre-cache references for patterns that need them
const nodes = raw[$NODE]
const titleSignal = nodes['title']

// A minimal 2-line function
function rs(r: any, p: string) { return r[$NODE][p]() }

// For pattern 12: getter via defineProperty
const getterObj = Object.create(null)
Object.defineProperty(getterObj, 'title', {
  get() { return titleSignal() },
  enumerable: true,
  configurable: true,
})

// For pattern 13: class with getter
class StoreView {
  get title() { return titleSignal() }
}
const classView = new StoreView()

// For pattern 14: preact-style .value wrapper
const preactStyle = { get value() { return titleSignal() } }

// For pattern: string property instead of symbol
raw.__nodes = nodes

describe('Exhaustive Read Patterns (100k reads inside effect)', () => {
  // ========== DIRECT PATTERNS (no function call) ==========

  bench('1. proxy.title (baseline)', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = store.title
      }
    })
    dispose()
  })

  bench('2. nodes[title]() — cached $NODE map', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = nodes['title']()
      }
    })
    dispose()
  })

  bench('3. raw[$NODE][title]() — uncached symbol lookup', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = raw[$NODE]['title']()
      }
    })
    dispose()
  })

  bench('4. raw.__nodes[title]() — string prop instead of symbol', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = raw.__nodes['title']()
      }
    })
    dispose()
  })

  bench('5. titleSignal() — direct signal ref in local var', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = titleSignal()
      }
    })
    dispose()
  })

  // ========== FUNCTION CALL PATTERNS ==========

  bench('6. readSignal(proxy, title) — current compiled output', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = readSignal(store, 'title')
      }
    })
    dispose()
  })

  bench('7. readLeaf(proxy, title) — $RAW shortcut', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = readLeaf(store, 'title')
      }
    })
    dispose()
  })

  bench('8. rs(raw, title) — minimal 2-line function', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = rs(raw, 'title')
      }
    })
    dispose()
  })

  bench('9. readSignal(raw, title) — pass raw directly', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = readSignal(raw, 'title')
      }
    })
    dispose()
  })

  // ========== OBJECT METHOD PATTERNS ==========

  bench('10. raw[$NODE].title() — dot access on nodes', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = raw[$NODE].title()
      }
    })
    dispose()
  })

  bench('11. inlined readSignal body (no function call)', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        // Inline the full readSignal logic — no function call overhead
        const r = (store as any)[$RAW] || store
        let n = (r as any)[$NODE]
        if (!n) {
          Object.defineProperty(r, $NODE, { value: {}, enumerable: false, configurable: true })
          n = (r as any)[$NODE]
        }
        const node = n['title'] || (n['title'] = alienSignal((r as any)['title']))
        acc = node()
      }
    })
    dispose()
  })

  // ========== GETTER / PROPERTY DESCRIPTOR PATTERNS ==========

  bench('12. Object.defineProperty getter', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = getterObj.title
      }
    })
    dispose()
  })

  bench('13. class with getter method', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = classView.title
      }
    })
    dispose()
  })

  // ========== PREACT-STYLE PATTERN ==========

  bench('14. preact-style .value getter', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = preactStyle.value
      }
    })
    dispose()
  })

  // ========== RAW SIGNAL BASELINE ==========

  bench('15. raw alien signal() — absolute ceiling', () => {
    const sig = alienSignal('Buy milk')
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = sig()
      }
    })
    dispose()
  })
})
