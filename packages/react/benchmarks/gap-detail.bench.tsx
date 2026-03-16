/**
 * Detailed gap analysis: isolate exactly which factor(s) cause the 4x gap
 * between direct-dom (~25ms) and solid-js (~6.4ms) on "Create 1000 rows".
 *
 * FINDING: The gap is caused by act() flushing React's scheduler BEFORE
 * the DOM nodes are removed. When 1000 rows are in the DOM when act()
 * resolves, act()'s post-callback flush costs ~25ms. When container.remove()
 * happens inside the act() callback, the flush sees an empty DOM and costs ~0.
 *
 * Run: pnpm --filter @supergrain/react exec npx vitest bench --config vitest.bench.config.ts benchmarks/gap-detail.bench.tsx
 */

import { bench, describe } from 'vitest'
import { createStore, effect } from '@supergrain/core'
import { $NODE, $RAW } from '@supergrain/core/internal'
import React, { useRef, useEffect } from 'react'
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

// --- Row template ---
const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`

/**
 * Core work: create store, build 1000 rows with cloneNode, wire 2000 effects.
 * Returns cleanup function.
 */
function coreWork(tbody: HTMLElement): () => void {
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

    const itemNodes = (item as any)[$NODE]
    if (itemNodes?.label) {
      cleanups.push(effect(() => { a1.textContent = itemNodes.label() }))
    }

    if (storeNodes?.selected) {
      const itemId = item.id
      cleanups.push(effect(() => {
        const selected = storeNodes.selected()
        tr.className = selected === itemId ? 'danger' : ''
      }))
    }

    tbody.appendChild(tr)
  }

  return () => { for (const c of cleanups) c() }
}

// --- Benchmarks ---

describe('Create 1000 rows - gap detail', () => {

  // A: Baseline — sync, no React, no act()
  bench('A: baseline (sync, no React)', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    const teardown = coreWork(tbody)
    teardown()
    container.remove()
    idCounter = 1
  })

  // B: async wrapper only (no act, no React)
  bench('B: async wrapper only', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    const teardown = coreWork(tbody)
    teardown()
    container.remove()
    idCounter = 1
  })

  // C: act() wrapping everything (including container.remove) — FAST
  bench('C: act() all inside (incl remove)', async () => {
    await act(async () => {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const table = document.createElement('table')
      const tbody = document.createElement('tbody')
      table.appendChild(tbody)
      container.appendChild(table)

      const teardown = coreWork(tbody)
      teardown()
      container.remove()
      idCounter = 1
    })
  })

  // D: container outside act(), work+teardown+remove inside act() — FAST
  bench('D: container outside, remove inside act()', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    await act(async () => {
      const teardown = coreWork(tbody)
      teardown()
      container.remove()
      idCounter = 1
    })
  })

  // E: work+teardown inside act(), remove OUTSIDE — SLOW (the bug!)
  bench('E: work inside act(), remove outside (SLOW)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = document.createElement('table')
    const tbody = document.createElement('tbody')
    table.appendChild(tbody)
    container.appendChild(table)

    await act(async () => {
      const teardown = coreWork(tbody)
      teardown()
    })

    container.remove()
    idCounter = 1
  })

  // F: React render + work inside act() + cleanup outside — SLOW (direct-dom pattern)
  bench('F: React + act() + cleanup outside (direct-dom)', async () => {
    render(
      React.createElement('table', null,
        React.createElement('tbody', null)
      )
    )

    const tbody = document.querySelector('tbody')!
    await act(async () => {
      const teardown = coreWork(tbody)
      teardown()
    })

    cleanup()
    idCounter = 1
  })

  // G: actual direct-dom bench (exact same code path)
  bench('G: actual direct-dom (exact)', async () => {
    const [store] = createStore<AppState>({ data: [], selected: null })
    const raw = (store as any)[$RAW] || store
    const storeNodes = raw[$NODE]

    const DirectDomApp: React.FC = () => {
      const tbodyRef = useRef<HTMLTableSectionElement>(null)
      const cleanupsRef = useRef<(() => void)[]>([])

      useEffect(() => {
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

  // H: render + cleanup cost only
  bench('H: render + cleanup only', () => {
    render(
      React.createElement('table', null,
        React.createElement('tbody', null)
      )
    )
    cleanup()
  })

  // I: React render + work outside act (no act at all)
  bench('I: React + work outside act (no act)', () => {
    render(
      React.createElement('table', null,
        React.createElement('tbody', null)
      )
    )

    const tbody = document.querySelector('tbody')!
    const teardown = coreWork(tbody)
    teardown()

    cleanup()
    idCounter = 1
  })

  // J: React render + empty act + cleanup
  bench('J: React + empty act() + cleanup', async () => {
    render(
      React.createElement('table', null,
        React.createElement('tbody', null)
      )
    )
    await act(async () => {})
    cleanup()
  })
})
