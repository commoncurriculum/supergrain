/**
 * Direct DOM krauset benchmark using supergrain's DirectFor component.
 *
 * Uses the library's actual API: createStore for state, DirectFor for
 * solid-js-level list rendering with cloneNode + signal bindings.
 */

import React, { useRef, useReducer, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createStore, effect as alienEffect } from '@supergrain/core'
import { DirectFor } from '@supergrain/react'

// --- Data Generation ---

let idCounter = 1

const adjectives = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome',
  'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful',
  'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive',
  'cheap', 'expensive', 'fancy',
]
const colours = [
  'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown',
  'white', 'black', 'orange',
]
const nouns = [
  'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie',
  'sandwich', 'burger', 'pizza', 'mouse', 'keyboard',
]

export function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max
}

export interface RowData {
  id: number
  label: string
}

export interface AppState {
  data: RowData[]
  selected: number | null
}

export function buildData(count: number): RowData[] {
  const data: RowData[] = new Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${nouns[_random(nouns.length)]}`,
    }
  }
  return data
}

// --- Store ---

export const [store] = createStore<AppState>({
  data: [],
  selected: null,
})

export const run = (count: number) => {
  store.data = buildData(count)
  store.selected = null
}

export const add = () => {
  store.data.push(...buildData(1000))
}

export const update = () => {
  for (let i = 0; i < store.data.length; i += 10) {
    store.data[i].label = store.data[i].label + ' !!!'
  }
}

export const clear = () => {
  store.data = []
  store.selected = null
}

export const swapRows = () => {
  if (store.data.length > 998) {
    const row1 = store.data[1]
    const row998 = store.data[998]
    store.data[1] = row998
    store.data[998] = row1
  }
}

export const remove = (id: number) => {
  const index = store.data.findIndex(item => item.id === id)
  if (index !== -1) {
    store.data.splice(index, 1)
  }
}

export const select = (id: number) => {
  store.selected = id
}

// --- Row template ---
export const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = `<td class="col-md-1"></td><td class="col-md-4"><a></a></td><td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>`

// --- App using DirectFor, mounting into existing tbody ---

export function App({ tbodyRef }: { tbodyRef: React.RefObject<HTMLElement> }) {
  // Subscribe to store.data changes so DirectFor gets updated `each` prop
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  useLayoutEffect(() => {
    return alienEffect(() => {
      store.data // read to subscribe
      forceUpdate()
    })
  }, [])

  return (
    <DirectFor
      each={store.data}
      template={rowTemplate}
      containerRef={tbodyRef}
      setup={(item: RowData, row: HTMLElement, addEffect: (fn: () => void) => void) => {
        const tds = row.children
        const td0 = tds[0] as HTMLElement
        const a1 = (tds[1] as HTMLElement).firstChild as HTMLAnchorElement
        const a2 = (tds[2] as HTMLElement).firstChild as HTMLAnchorElement

        td0.textContent = String(item.id)
        a1.textContent = item.label
        a1.onclick = () => select(item.id)
        a2.onclick = () => remove(item.id)

        addEffect(() => { a1.textContent = (item as any).label })
        addEffect(() => {
          row.className = store.selected === item.id ? 'danger' : ''
        })
      }}
    />
  )
}

// --- Button event listeners ---
if (typeof window !== 'undefined' && document.getElementById('run')) {
  document.getElementById('run')!.addEventListener('click', () => run(1000))
  document.getElementById('runlots')!.addEventListener('click', () => run(10000))
  document.getElementById('add')!.addEventListener('click', add)
  document.getElementById('update')!.addEventListener('click', update)
  document.getElementById('clear')!.addEventListener('click', clear)
  document.getElementById('swaprows')!.addEventListener('click', swapRows)
}

// --- Mount ---
// Pass a ref to the existing tbody so DirectFor appends rows directly into it
if (typeof window !== 'undefined' && document.getElementById('tbody')) {
  const tbody = document.getElementById('tbody')!
  const tbodyRef = { current: tbody } as React.RefObject<HTMLElement>

  // Mount React on a separate div (not the tbody) — App renders null,
  // DirectFor uses the tbodyRef to append rows directly
  const mountPoint = document.createElement('div')
  document.body.appendChild(mountPoint)
  const root = createRoot(mountPoint)
  root.render(<App tbodyRef={tbodyRef} />)
}
