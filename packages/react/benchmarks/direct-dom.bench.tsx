/**
 * Direct DOM benchmark: Solid-style template cloning within React.
 *
 * React renders the outer container. Rows are created via cloneNode +
 * direct signal subscriptions — no React components, no VDOM, no memo.
 *
 * Run: cd packages/react && npx vitest bench --config vitest.bench.config.ts benchmarks/direct-dom.bench.tsx
 */

import { bench, describe } from 'vitest'
import { createStore, createView, $NODE, $RAW, effect, getCurrentSub, setCurrentSub } from '@supergrain/core'
import { useTracked, For } from '../src/use-store'
import React, { FC, memo, useCallback, useReducer, useRef, useEffect, useLayoutEffect } from 'react'
import { render, cleanup, act } from '@testing-library/react'

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

// --- Row template (cloned, not rendered by React) ---
const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`

// --- Proxy App (baseline — standard React) ---
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

const ProxyApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = memo(({ store, sel, rem }) => {
  const state = useTracked(store)
  const hs = useCallback((id: number) => sel(id), [])
  const hr = useCallback((id: number) => rem(id), [])
  return <table><tbody><For each={state.data}>{(item: RowData) => (
    <Row key={item.id} item={item} isSelected={state.selected === item.id} onSelect={hs} onRemove={hr} />
  )}</For></tbody></table>
})

// --- Direct DOM App: cloneNode + signal wiring, no React rows ---
const DirectDomApp: FC<{ store: any; sel: (id: number) => void; rem: (id: number) => void }> = ({ store, sel, rem }) => {
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const cleanups = useRef<(() => void)[]>([])

  useEffect(() => {
    const raw = (store as any)[$RAW] || store
    const storeNodes = raw[$NODE]

    // Watch the data signal — when data changes, rebuild all rows
    const dataCleanup = effect(() => {
      const data: RowData[] = storeNodes.data()
      const tbody = tbodyRef.current!

      // Tear down old subscriptions
      for (const c of cleanups.current) c()
      cleanups.current = []

      // Clear DOM
      tbody.textContent = ''

      // Build rows via cloneNode
      for (const item of data) {
        const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
        const tds = tr.children
        const td0 = tds[0] as HTMLElement
        const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
        const a2 = (tds[2] as HTMLElement).firstChild as HTMLAnchorElement

        // Static content
        td0.textContent = String(item.id)
        a1.textContent = item.label

        // Event listeners
        a1.onclick = () => sel(item.id)
        a2.onclick = () => rem(item.id)

        // Subscribe label signal → DOM
        const itemNodes = (item as any)[$NODE]
        if (itemNodes?.label) {
          const c = effect(() => {
            a1.textContent = itemNodes.label()
          })
          cleanups.current.push(c)
        }

        // Subscribe selected signal → className
        if (storeNodes?.selected) {
          const itemId = item.id
          const c = effect(() => {
            const selected = storeNodes.selected()
            tr.className = selected === itemId ? 'danger' : ''
          })
          cleanups.current.push(c)
        }

        tbody.appendChild(tr)
      }
    })

    return () => {
      dataCleanup()
      for (const c of cleanups.current) c()
      cleanups.current = []
    }
  }, [store])

  return <table><tbody ref={tbodyRef} /></table>
}

function makeStore() {
  const [store, upd] = createStore<AppState>({ data: [], selected: null })
  return {
    store, upd,
    run: (n: number) => { store.data = buildData(n); store.selected = null },
    sel: (id: number) => { store.selected = id },
    update10th: () => { for (let i = 0; i < store.data.length; i += 10) store.data[i].label += ' !!!' },
    swap: () => {
      if (store.data.length > 998) {
        const a = store.data[1], b = store.data[998]
        store.data[1] = b; store.data[998] = a
      }
    },
  }
}

// --- Benchmarks ---

describe('Create 1000 rows', () => {
  bench('proxy (React)', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    cleanup(); idCounter = 1
  })
  bench('direct-dom (cloneNode)', async () => {
    const ctx = makeStore()
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    cleanup(); idCounter = 1
  })
})

describe('Select row', () => {
  bench('proxy (React)', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.sel(500) })
    cleanup(); idCounter = 1
  })
  bench('direct-dom (cloneNode)', async () => {
    const ctx = makeStore()
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.sel(500) })
    cleanup(); idCounter = 1
  })
})

describe('Swap rows', () => {
  bench('proxy (React)', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.swap() })
    cleanup(); idCounter = 1
  })
  bench('direct-dom (cloneNode)', async () => {
    const ctx = makeStore()
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.swap() })
    cleanup(); idCounter = 1
  })
})

describe('Partial update (100 of 1000)', () => {
  bench('proxy (React)', async () => {
    const ctx = makeStore()
    render(<ProxyApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.update10th() })
    cleanup(); idCounter = 1
  })
  bench('direct-dom (cloneNode)', async () => {
    const ctx = makeStore()
    render(<DirectDomApp store={ctx.store} sel={ctx.sel} rem={ctx.rem} />)
    await act(async () => { ctx.run(1000) })
    await act(async () => { ctx.update10th() })
    cleanup(); idCounter = 1
  })
})
