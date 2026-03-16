/**
 * Krauset-style benchmark: proxy vs class-getter vs fine-grained
 *
 * Three modes:
 * - proxy: useTracked in App, For iterates, memo compares
 * - class-getter: class view in App, same For/memo pattern
 * - fine-grained: each Row subscribes independently to its own signals,
 *   parent doesn't re-render on selection changes
 *
 * Run: cd packages/react && npx vitest bench --config vitest.bench.config.ts
 */

import { bench, describe } from 'vitest'
import { createStore, createView, $NODE, $RAW, effect, getCurrentSub, setCurrentSub } from '@supergrain/core'
import { signal } from 'alien-signals'
import { useTracked, For } from '../src/use-store'
import React, { FC, memo, useCallback, useReducer, useRef, useEffect, useLayoutEffect } from 'react'
import { render, cleanup, act } from '@testing-library/react'

// --- Shared ---
function useReactiveEffect() {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<{ cleanup: (() => void) | null; effectNode: any } | null>(null)
  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true
    const c = effect(() => {
      if (isFirstRun) { effectNode = getCurrentSub(); isFirstRun = false; return }
      forceUpdate()
    })
    stateRef.current = { cleanup: c, effectNode }
  }
  const prevSub = getCurrentSub()
  setCurrentSub(stateRef.current.effectNode)
  useLayoutEffect(() => { setCurrentSub(prevSub) })
  useEffect(() => { return () => { stateRef.current?.cleanup?.(); } }, [])
}

function ensureNode(nodes: any, key: string, raw: any) {
  if (!nodes[key]) nodes[key] = signal(raw[key])
}

function getOrCreateNodes(raw: any) {
  let nodes = raw[$NODE]
  if (!nodes) {
    Object.defineProperty(raw, $NODE, { value: {}, enumerable: false, configurable: true })
    nodes = raw[$NODE]
  }
  return nodes
}

class AppStateView {
  _n: any
  constructor(raw: any) {
    const nodes = getOrCreateNodes(raw)
    ensureNode(nodes, 'data', raw)
    ensureNode(nodes, 'selected', raw)
    this._n = nodes
  }
  get data(): any[] { return this._n.data() }
  get selected(): number | null { return this._n.selected() }
}

function useClassView<T extends object, V>(store: T, ViewClass: new (raw: any) => V): V {
  useReactiveEffect()
  const ref = useRef<{ view: V; raw: any } | null>(null)
  const raw = (store as any)[$RAW] || store
  if (!ref.current || ref.current.raw !== raw) {
    ref.current = { view: new ViewClass(raw), raw }
  }
  return ref.current.view
}

// --- Types & data ---
interface RowData { id: number; label: string }
interface AppState { data: RowData[]; selected: number | null }

let idCounter = 1
const adj = ['pretty','large','big','small','tall','short','long','handsome','plain','quaint']
const col = ['red','yellow','blue','green','pink','brown','purple','white','black','orange']
const nou = ['table','chair','house','bbq','desk','car','pony','cookie','sandwich','burger']
const rnd = (max: number) => Math.round(Math.random() * 1000) % max

function buildData(count: number): RowData[] {
  const d: RowData[] = new Array(count)
  for (let i = 0; i < count; i++) {
    d[i] = { id: idCounter++, label: `${adj[rnd(adj.length)]} ${col[rnd(col.length)]} ${nou[rnd(nou.length)]}` }
  }
  return d
}

// --- Row (shared) ---
const Row: FC<{ item: RowData; isSelected: boolean; onSelect: (id: number) => void; onRemove: (id: number) => void }> = memo(
  ({ item, isSelected, onSelect, onRemove }) => (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4"><a onClick={() => onSelect(item.id)}>{item.label}</a></td>
      <td className="col-md-1"><a onClick={() => onRemove(item.id)}><span className="glyphicon glyphicon-remove" /></a></td>
      <td className="col-md-6"></td>
    </tr>
  )
)

// --- Fine-grained Row: subscribes to selected independently ---
const FineRow: FC<{ item: RowData; store: any; onSelect: (id: number) => void; onRemove: (id: number) => void }> = memo(
  ({ item, store, onSelect, onRemove }) => {
    // This row subscribes to 'selected' signal directly
    useReactiveEffect()
    const raw = (store as any)[$RAW] || store
    const nodes = raw[$NODE]
    const selected = nodes?.selected?.() ?? null
    const isSelected = selected === item.id

    return (
      <tr className={isSelected ? 'danger' : ''}>
        <td className="col-md-1">{item.id}</td>
        <td className="col-md-4"><a onClick={() => onSelect(item.id)}>{item.label}</a></td>
        <td className="col-md-1"><a onClick={() => onRemove(item.id)}><span className="glyphicon glyphicon-remove" /></a></td>
        <td className="col-md-6"></td>
      </tr>
    )
  }
)

// --- Apps ---
const ProxyApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = memo(({ store, sel, rem }) => {
  const state = useTracked(store)
  const hs = useCallback((id: number) => sel(id), [])
  const hr = useCallback((id: number) => rem(id), [])
  return <table><tbody><For each={state.data}>{(item: RowData) => (
    <Row key={item.id} item={item} isSelected={state.selected === item.id} onSelect={hs} onRemove={hr} />
  )}</For></tbody></table>
})

const GetterApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = memo(({ store, sel, rem }) => {
  const view = useClassView(store, AppStateView)
  const hs = useCallback((id: number) => sel(id), [])
  const hr = useCallback((id: number) => rem(id), [])
  return <table><tbody><For each={view.data}>{(item: RowData) => (
    <Row key={item.id} item={item} isSelected={view.selected === item.id} onSelect={hs} onRemove={hr} />
  )}</For></tbody></table>
})

// Fine-grained: App only subscribes to data, each row subscribes to selected
const FineApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = memo(({ store, sel, rem }) => {
  const view = useClassView(store, AppStateView)
  const hs = useCallback((id: number) => sel(id), [])
  const hr = useCallback((id: number) => rem(id), [])
  // Only read data — NOT selected. Each row reads selected independently.
  return <table><tbody><For each={view.data}>{(item: RowData) => (
    <FineRow key={item.id} item={item} store={store} onSelect={hs} onRemove={hr} />
  )}</For></tbody></table>
})

// createView: App uses createView for prototype-getter reads
const ViewApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = memo(({ store, sel, rem }) => {
  useReactiveEffect()
  const view = createView(store) as AppState
  const hs = useCallback((id: number) => sel(id), [])
  const hr = useCallback((id: number) => rem(id), [])
  return <table><tbody><For each={view.data}>{(item: RowData) => (
    <Row key={item.id} item={item} isSelected={view.selected === item.id} onSelect={hs} onRemove={hr} />
  )}</For></tbody></table>
})

function makeStore() {
  const [store, upd] = createStore<AppState>({ data: [], selected: null })
  return {
    store, upd,
    run: (n: number) => { store.data = buildData(n); store.selected = null },
    sel: (id: number) => { store.selected = id },
    rem: (id: number) => { upd({ $pull: { data: { id } } }) },
    update10th: () => { for (let i = 0; i < store.data.length; i += 10) store.data[i].label += ' !!!' },
    swap: () => {
      if (store.data.length > 998) {
        const a = store.data[1], b = store.data[998]
        store.data[1] = b; store.data[998] = a
      }
    },
    clear: () => { store.data = []; store.selected = null },
  }
}

// --- Benchmarks ---

describe('Create 1000 rows', () => {
  bench('proxy', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    cleanup(); idCounter = 1
  })
  bench('class-getter', async () => {
    const ctx = makeStore()
    render(<GetterApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    cleanup(); idCounter = 1
  })
  bench('fine-grained', async () => {
    const ctx = makeStore()
    render(<FineApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    cleanup(); idCounter = 1
  })
  bench('createView', async () => {
    const ctx = makeStore()
    render(<ViewApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    cleanup(); idCounter = 1
  })
})

describe('Select row', () => {
  bench('proxy', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.sel(500) })
    cleanup(); idCounter = 1
  })
  bench('class-getter', async () => {
    const ctx = makeStore()
    render(<GetterApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.sel(500) })
    cleanup(); idCounter = 1
  })
  bench('fine-grained', async () => {
    const ctx = makeStore()
    render(<FineApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.sel(500) })
    cleanup(); idCounter = 1
  })
  bench('createView', async () => {
    const ctx = makeStore()
    render(<ViewApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.sel(500) })
    cleanup(); idCounter = 1
  })
})

describe('Swap rows', () => {
  bench('proxy', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.swap() })
    cleanup(); idCounter = 1
  })
  bench('class-getter', async () => {
    const ctx = makeStore()
    render(<GetterApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.swap() })
    cleanup(); idCounter = 1
  })
  bench('fine-grained', async () => {
    const ctx = makeStore()
    render(<FineApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.swap() })
    cleanup(); idCounter = 1
  })
  bench('createView', async () => {
    const ctx = makeStore()
    render(<ViewApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.swap() })
    cleanup(); idCounter = 1
  })
})

describe('Partial update (100 of 1000)', () => {
  bench('proxy', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.update10th() })
    cleanup(); idCounter = 1
  })
  bench('class-getter', async () => {
    const ctx = makeStore()
    render(<GetterApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.update10th() })
    cleanup(); idCounter = 1
  })
  bench('fine-grained', async () => {
    const ctx = makeStore()
    render(<FineApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.update10th() })
    cleanup(); idCounter = 1
  })
  bench('createView', async () => {
    const ctx = makeStore()
    render(<ViewApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.update10th() })
    cleanup(); idCounter = 1
  })
})
