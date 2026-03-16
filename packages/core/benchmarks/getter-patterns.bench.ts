// @ts-nocheck — benchmark file, sink variables prevent dead code elimination
// Dynamic vs static prototype getters — tests whether a compiler is needed.
import { bench, describe } from 'vitest'
import { createStore, unwrap } from '../src'
import { $NODE } from '../src/internal'
import { effect } from 'alien-signals'

const [store] = createStore({ title: 'Buy milk' })
const raw = unwrap(store) as any
// Ensure signal exists
effect(() => {
  store.title
})
const nodes = raw[$NODE]

// @ts-nocheck — benchmark file, sink variables prevent dead code elimination

// --- Pattern 1: Static class getter (baseline) ---
class StaticView {
  _n: any
  constructor(n: any) {
    this._n = n
  }
  get title() {
    return this._n.title()
  }
}

// --- Pattern 2: Dynamic class via Function constructor + prototype ---
function createViewClass(keys: string[]) {
  function View(this: any, n: any) {
    this._n = n
  }
  for (const key of keys) {
    Object.defineProperty(View.prototype, key, {
      get() {
        return this._n[key]()
      },
      enumerable: true,
      configurable: true,
    })
  }
  return View as any
}
const DynamicView = createViewClass(['title'])

// --- Pattern 3: Object.setPrototypeOf on a raw object ---
const proto3: any = {}
Object.defineProperty(proto3, 'title', {
  get() {
    return this._n.title()
  },
  enumerable: true,
  configurable: true,
})

// --- Pattern 4: ES6 class created dynamically with new Function ---
const DynamicES6Class = new Function(
  'NODE_SYM',
  `
  return class {
    constructor(n) { this._n = n }
    get title() { return this._n.title() }
  }
`
)($NODE) as any

// --- Pattern 5: Object.defineProperty on the instance (not prototype) ---
function createInstanceWithGetters(n: any) {
  const obj: any = {}
  Object.defineProperty(obj, 'title', {
    get() {
      return n.title()
    },
    enumerable: true,
    configurable: true,
  })
  return obj
}

describe('Getter patterns: 100k reads inside effect()', () => {
  bench('P1: Static class getter (baseline)', () => {
    const view = new StaticView(nodes)
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = view.title
      }
    })
    _sink = acc
    dispose()
  })

  bench('P2: Dynamic Function+prototype getter', () => {
    const view = new DynamicView(nodes)
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = view.title
      }
    })
    _sink = acc
    dispose()
  })

  bench('P3: Object.setPrototypeOf raw object', () => {
    const obj: any = { _n: nodes }
    Object.setPrototypeOf(obj, proto3)
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = obj.title
      }
    })
    _sink = acc
    dispose()
  })

  bench('P4: Dynamic ES6 class (new Function)', () => {
    const view = new DynamicES6Class(nodes)
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = view.title
      }
    })
    _sink = acc
    dispose()
  })

  bench('P5: defineProperty on instance', () => {
    const obj = createInstanceWithGetters(nodes)
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = obj.title
      }
    })
    _sink = acc
    dispose()
  })

  bench('P6: Proxy baseline (store.title)', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = store.title
      }
    })
    _sink = acc
    dispose()
  })

  bench('P7: Direct signal call (ceiling)', () => {
    let acc: any
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        acc = nodes.title()
      }
    })
    _sink = acc
    dispose()
  })
})
