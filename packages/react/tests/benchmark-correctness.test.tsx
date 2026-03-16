/**
 * Verify that all benchmark implementations actually produce correct DOM.
 * This ensures benchmark numbers reflect real work, not no-ops.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createStore, createView, $NODE, $RAW, effect, getCurrentSub, setCurrentSub } from '@supergrain/core'
import { useTracked, For } from '../src/use-store'
import React, { FC, memo, useCallback, useState, useReducer, useRef, useEffect, useLayoutEffect } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { createRoot as createSolidRoot, createEffect as createSolidEffect, createSignal, batch as solidBatch } from 'solid-js'
import { createStore as createSolidStore } from 'solid-js/store'

// --- Shared data ---
interface RowData { id: number; label: string }
interface AppState { data: RowData[]; selected: number | null }

function testData(): RowData[] {
  return [
    { id: 1, label: 'red table' },
    { id: 2, label: 'blue chair' },
    { id: 3, label: 'green house' },
  ]
}

// --- Row template (same as benchmark) ---
const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`

// --- Shared helpers ---
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

// --- Helper to extract row data from a tbody ---
function getRowsFromTbody(tbody: HTMLElement): { id: string; label: string; className: string }[] {
  const rows: { id: string; label: string; className: string }[] = []
  const trs = tbody.querySelectorAll('tr')
  for (const tr of trs) {
    const tds = tr.querySelectorAll('td')
    const id = tds[0]?.textContent ?? ''
    const a = tds[1]?.querySelector('a')
    const label = a?.textContent ?? ''
    rows.push({ id, label, className: tr.className })
  }
  return rows
}

afterEach(() => cleanup())

describe('Proxy (React) correctness', () => {
  const Row: FC<{ item: RowData; isSelected: boolean }> = memo(({ item, isSelected }) => (
    <tr className={isSelected ? 'danger' : ''}>
      <td>{item.id}</td>
      <td><a>{item.label}</a></td>
    </tr>
  ))

  const App: FC<{ store: any }> = ({ store }) => {
    const state = useTracked(store)
    return <table><tbody data-testid="tbody"><For each={state.data}>{(item: RowData) => (
      <Row key={item.id} item={item} isSelected={state.selected === item.id} />
    )}</For></tbody></table>
  }

  it('renders rows correctly', async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null })
    const { container } = render(<App store={store} />)
    const tbody = container.querySelector('tbody')!
    const rows = getRowsFromTbody(tbody)
    expect(rows).toHaveLength(3)
    expect(rows[0].id).toBe('1')
    expect(rows[0].label).toBe('red table')
    expect(rows[1].label).toBe('blue chair')
  })

  it('updates label reactively', async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null })
    const { container } = render(<App store={store} />)
    await act(async () => { store.data[0].label = 'updated label' })
    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows[0].label).toBe('updated label')
  })

  it('selects row reactively', async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null })
    const { container } = render(<App store={store} />)
    await act(async () => { store.selected = 2 })
    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows[0].className).toBe('')
    expect(rows[1].className).toBe('danger')
  })
})

describe('Direct DOM (supergrain $$) correctness', () => {
  const DirectDomApp: FC<{ store: any }> = ({ store }) => {
    const tbodyRef = useRef<HTMLTableSectionElement>(null)
    const cleanups = useRef<(() => void)[]>([])

    useEffect(() => {
      const raw = (store as any)[$RAW] || store
      const storeNodes = raw[$NODE]

      const dataCleanup = effect(() => {
        const data: RowData[] = storeNodes.data()
        const tbody = tbodyRef.current!
        for (const c of cleanups.current) c()
        cleanups.current = []
        tbody.textContent = ''

        for (const item of data) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
          const tds = tr.children
          ;(tds[0] as HTMLElement).textContent = String(item.id)
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
          a1.textContent = item.label

          const itemNodes = (item as any)[$NODE]
          if (itemNodes?.label) {
            const c = effect(() => { a1.textContent = itemNodes.label() })
            cleanups.current.push(c)
          }
          if (storeNodes?.selected) {
            const itemId = item.id
            const c = effect(() => { tr.className = storeNodes.selected() === itemId ? 'danger' : '' })
            cleanups.current.push(c)
          }
          tbody.appendChild(tr)
        }
      })

      return () => { dataCleanup(); for (const c of cleanups.current) c() }
    }, [])

    return <table><tbody ref={tbodyRef} /></table>
  }

  it('renders rows correctly', async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null })
    const { container } = render(<DirectDomApp store={store} />)
    await act(async () => {}) // let effects run
    const tbody = container.querySelector('tbody')!
    const rows = getRowsFromTbody(tbody)
    expect(rows).toHaveLength(3)
    expect(rows[0].id).toBe('1')
    expect(rows[0].label).toBe('red table')
    expect(rows[1].label).toBe('blue chair')
  })

  it('updates label reactively', async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null })
    const { container } = render(<DirectDomApp store={store} />)
    await act(async () => {}) // let effects run
    await act(async () => { store.data[0].label = 'updated label' })
    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows[0].label).toBe('updated label')
  })

  it('selects row reactively', async () => {
    const [store] = createStore<AppState>({ data: testData(), selected: null })
    const { container } = render(<DirectDomApp store={store} />)
    await act(async () => {}) // let effects run
    await act(async () => { store.selected = 2 })
    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows[0].className).toBe('')
    expect(rows[1].className).toBe('danger')
  })
})

describe('Solid-js correctness', () => {
  it('renders rows correctly', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let dispose: () => void
    createSolidRoot(d => {
      dispose = d
      const [s, ss] = createSolidStore<AppState>({ data: testData(), selected: null })

      const table = document.createElement('table')
      const tbody = document.createElement('tbody')
      table.appendChild(tbody)
      container.appendChild(table)

      createSolidEffect(() => {
        tbody.textContent = ''
        for (const item of s.data) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
          const tds = tr.children
          ;(tds[0] as HTMLElement).textContent = String(item.id)
          ;((tds[1] as HTMLElement).firstChild as HTMLAnchorElement).textContent = item.label
          tbody.appendChild(tr)
        }
      })
    })

    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows).toHaveLength(3)
    expect(rows[0].id).toBe('1')
    expect(rows[0].label).toBe('red table')
    expect(rows[1].label).toBe('blue chair')

    dispose!()
    container.remove()
  })

  it('updates label reactively', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let dispose: () => void
    let setStore: any

    createSolidRoot(d => {
      dispose = d
      const [s, ss] = createSolidStore<AppState>({ data: testData(), selected: null })
      setStore = ss

      const table = document.createElement('table')
      const tbody = document.createElement('tbody')
      table.appendChild(tbody)
      container.appendChild(table)

      createSolidEffect(() => {
        tbody.textContent = ''
        for (let i = 0; i < s.data.length; i++) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
          const tds = tr.children
          ;(tds[0] as HTMLElement).textContent = String(s.data[i].id)
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
          createSolidRoot(() => {
            createSolidEffect(() => { a1.textContent = s.data[i].label })
          })
          tbody.appendChild(tr)
        }
      })
    })

    setStore('data', 0, 'label', 'updated label')
    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows[0].label).toBe('updated label')

    dispose!()
    container.remove()
  })

  it('selects row reactively', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let dispose: () => void
    let setStore: any

    createSolidRoot(d => {
      dispose = d
      const [s, ss] = createSolidStore<AppState>({ data: testData(), selected: null })
      setStore = ss

      const table = document.createElement('table')
      const tbody = document.createElement('tbody')
      table.appendChild(tbody)
      container.appendChild(table)

      createSolidEffect(() => {
        tbody.textContent = ''
        for (const item of s.data) {
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
          const tds = tr.children
          ;(tds[0] as HTMLElement).textContent = String(item.id)
          ;((tds[1] as HTMLElement).firstChild as HTMLAnchorElement).textContent = item.label
          const itemId = item.id
          createSolidRoot(() => {
            createSolidEffect(() => { tr.className = s.selected === itemId ? 'danger' : '' })
          })
          tbody.appendChild(tr)
        }
      })
    })

    setStore('selected', 2)
    const rows = getRowsFromTbody(container.querySelector('tbody')!)
    expect(rows[0].className).toBe('')
    expect(rows[1].className).toBe('danger')

    dispose!()
    container.remove()
  })
})
