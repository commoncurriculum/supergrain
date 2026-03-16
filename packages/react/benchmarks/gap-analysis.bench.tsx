/**
 * Gap analysis benchmark: isolate where the 2-4x gap between
 * direct-dom (supergrain) and solid-js comes from.
 *
 * Run: pnpm --filter @supergrain/react exec npx vitest bench --config vitest.bench.config.ts benchmarks/gap-analysis.bench.tsx
 */

import { bench, describe } from 'vitest'
import { createStore, effect } from '@supergrain/core'
import { $NODE, $RAW } from '@supergrain/core/internal'
import { signal as alienSignal } from 'alien-signals'
import {
  createRoot as createSolidRoot,
  createEffect as createSolidEffect,
  createSignal,
  batch as solidBatch,
} from 'solid-js'
import { createStore as createSolidStore } from 'solid-js/store'
import React from 'react'
import { render, cleanup, act } from '@testing-library/react'

// --- Types & data (copied from direct-dom.bench.tsx) ---
interface RowData {
  id: number
  label: string
}
interface AppState {
  data: RowData[]
  selected: number | null
}

let idCounter = 1
const adj = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint']
const col = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange']
const nou = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger']
const rnd = (max: number) => Math.round(Math.random() * 1000) % max

function buildData(count: number): RowData[] {
  const d: RowData[] = new Array(count)
  for (let i = 0; i < count; i++) {
    d[i] = {
      id: idCounter++,
      label: `${adj[rnd(adj.length)]} ${col[rnd(col.length)]} ${nou[rnd(nou.length)]}`,
    }
  }
  return d
}

// --- Row template (cloned, not rendered by React) ---
const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`

// --- Benchmarks ---

describe('Create 1000 rows - gap analysis', () => {
  // 1. Solid-js baseline
  bench('1. solid-js (baseline)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    let dispose!: () => void
    createSolidRoot((d) => {
      dispose = d
      const [s, ss] = createSolidStore<AppState>({ data: [], selected: null })
      const table = document.createElement('table')
      const tbody = document.createElement('tbody')
      table.appendChild(tbody)
      container.appendChild(table)

      const [dataLen, setDataLen] = createSignal(0)
      let rowCleanups: (() => void)[] = []

      createSolidEffect(() => {
        const len = dataLen()
        for (const c of rowCleanups) c()
        rowCleanups = []
        tbody.textContent = ''

        for (let idx = 0; idx < len; idx++) {
          const item = s.data[idx]
          const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
          const tds = tr.children
          ;(tds[0] as HTMLElement).textContent = String(item.id)
          const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
          a1.textContent = item.label

          const capturedIdx = idx
          const itemId = item.id
          createSolidRoot((dRow) => {
            rowCleanups.push(dRow)
            createSolidEffect(() => {
              a1.textContent = s.data[capturedIdx].label
            })
            createSolidEffect(() => {
              tr.className = s.selected === itemId ? 'danger' : ''
            })
          })

          tbody.appendChild(tr)
        }
      })

      // Run: create 1000 rows
      const data = buildData(1000)
      solidBatch(() => {
        ss('data', data)
        ss('selected', null)
      })
      setDataLen(data.length)
    })

    dispose()
    container.remove()
    idCounter = 1
  })

  // 2. Pure DOM - no signals at all
  bench('2. pure-dom (no signals)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    const data = buildData(1000)
    for (const item of data) {
      const tr = rowTemplate.cloneNode(true) as HTMLElement
      const tds = tr.children
      ;(tds[0] as HTMLElement).textContent = String(item.id)
      ;((tds[1] as HTMLElement).firstChild as HTMLAnchorElement).textContent = item.label
      tbody.appendChild(tr)
    }

    container.remove()
    idCounter = 1
  })

  // 3. Pure DOM + alien-signals effects
  bench('3. pure-dom + alien-signals', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    const data = buildData(1000)
    const cleanups: (() => void)[] = []

    for (const item of data) {
      const tr = rowTemplate.cloneNode(true) as HTMLElement
      const tds = tr.children
      ;(tds[0] as HTMLElement).textContent = String(item.id)
      const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
      a1.textContent = item.label

      const labelSig = alienSignal(item.label)
      const selectedSig = alienSignal(false)

      cleanups.push(effect(() => { a1.textContent = labelSig() }))
      cleanups.push(effect(() => { tr.className = selectedSig() ? 'danger' : '' }))

      tbody.appendChild(tr)
    }

    for (const c of cleanups) c()
    container.remove()
    idCounter = 1
  })

  // 4. Pure DOM + solid-signals
  bench('4. pure-dom + solid-signals', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    let dispose!: () => void
    createSolidRoot((d) => {
      dispose = d

      const data = buildData(1000)
      for (const item of data) {
        const tr = rowTemplate.cloneNode(true) as HTMLElement
        const tds = tr.children
        ;(tds[0] as HTMLElement).textContent = String(item.id)
        const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
        a1.textContent = item.label

        const [label] = createSignal(item.label)
        const [selected] = createSignal(false)

        createSolidEffect(() => { a1.textContent = label() })
        createSolidEffect(() => { tr.className = selected() ? 'danger' : '' })

        tbody.appendChild(tr)
      }
    })

    dispose()
    container.remove()
    idCounter = 1
  })

  // 5. Pure DOM + alien-signals + supergrain store
  bench('5. pure-dom + alien-signals + supergrain store', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    const [store] = createStore<AppState>({ data: [], selected: null })
    store.data = buildData(1000)
    store.selected = null

    const raw = (store as any)[$RAW] || store
    const storeNodes = raw[$NODE]
    const data: RowData[] = store.data

    const cleanups: (() => void)[] = []

    for (const item of data) {
      const tr = rowTemplate.cloneNode(true) as HTMLElement
      const tds = tr.children
      ;(tds[0] as HTMLElement).textContent = String(item.id)
      const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
      a1.textContent = item.label

      // Subscribe label signal from store node
      const itemNodes = (item as any)[$NODE]
      if (itemNodes?.label) {
        cleanups.push(effect(() => { a1.textContent = itemNodes.label() }))
      }

      // Subscribe selected signal from store node
      if (storeNodes?.selected) {
        const itemId = item.id
        cleanups.push(effect(() => {
          const selected = storeNodes.selected()
          tr.className = selected === itemId ? 'danger' : ''
        }))
      }

      tbody.appendChild(tr)
    }

    for (const c of cleanups) c()
    container.remove()
    idCounter = 1
  })

  // 6. React mount only (no rows, no signals)
  bench('6. react-mount only', async () => {
    render(
      React.createElement('table', null,
        React.createElement('tbody', null)
      )
    )
    cleanup()
  })

  // 7. React mount + act()
  bench('7. react-mount + act()', async () => {
    render(
      React.createElement('table', null,
        React.createElement('tbody', null)
      )
    )
    await act(async () => {})
    cleanup()
  })

  // 8. Direct-dom (current implementation)
  bench('8. direct-dom (current)', async () => {
    const [store] = createStore<AppState>({ data: [], selected: null })

    const DirectDomApp: React.FC = () => {
      const tbodyRef = React.useRef<HTMLTableSectionElement>(null)
      const cleanupsRef = React.useRef<(() => void)[]>([])

      React.useEffect(() => {
        const raw = (store as any)[$RAW] || store
        const storeNodes = raw[$NODE]

        const dataCleanup = effect(() => {
          const data: RowData[] = storeNodes.data()
          const tbody = tbodyRef.current!

          for (const c of cleanupsRef.current) c()
          cleanupsRef.current = []
          tbody.textContent = ''

          for (const item of data) {
            const tr = rowTemplate.cloneNode(true) as HTMLTableRowElement
            const tds = tr.children
            ;(tds[0] as HTMLElement).textContent = String(item.id)
            const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
            a1.textContent = item.label

            const itemNodes = (item as any)[$NODE]
            if (itemNodes?.label) {
              cleanupsRef.current.push(effect(() => { a1.textContent = itemNodes.label() }))
            }
            if (storeNodes?.selected) {
              const itemId = item.id
              cleanupsRef.current.push(effect(() => {
                tr.className = storeNodes.selected() === itemId ? 'danger' : ''
              }))
            }

            tbody.appendChild(tr)
          }
        })

        return () => {
          dataCleanup()
          for (const c of cleanupsRef.current) c()
          cleanupsRef.current = []
        }
      }, [])

      return React.createElement('table', null,
        React.createElement('tbody', { ref: tbodyRef })
      )
    }

    render(React.createElement(DirectDomApp))
    await act(async () => {
      store.data = buildData(1000)
      store.selected = null
    })
    cleanup()
    idCounter = 1
  })
})
