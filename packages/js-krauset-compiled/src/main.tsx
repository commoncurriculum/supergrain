/**
 * Hand-written "compiled" version of the krauset benchmark.
 *
 * This represents what the vite plugin SHOULD produce.
 * Proxy version: useTracked(store) → reads go through proxy get trap.
 * This version: useCompiled(store) → reads go through $NODE signals directly.
 *
 * Only the App component needs signal reads (it tracks data + selected).
 * Row is memoized and receives plain values as props — no signals needed.
 */

import { FC, memo, useCallback, useReducer, useRef, useEffect, useLayoutEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { For } from '@supergrain/react'
import { createStore, $NODE, $RAW, effect, getCurrentSub, setCurrentSub } from '@supergrain/core'

function useCompiled<T extends object>(store: T) {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
  const stateRef = useRef<{ cleanup: (() => void) | null; effectNode: any; raw: any; nodes: any } | null>(null)

  if (!stateRef.current) {
    let effectNode: any = null
    let isFirstRun = true
    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        return
      }
      forceUpdate()
    })
    const raw = (store as any)[$RAW] || store
    stateRef.current = { cleanup, effectNode, raw, nodes: raw[$NODE] }
  }

  const prevSub = getCurrentSub()
  setCurrentSub(stateRef.current.effectNode)

  useLayoutEffect(() => {
    setCurrentSub(prevSub)
  })

  useEffect(() => {
    return () => {
      if (stateRef.current?.cleanup) {
        stateRef.current.cleanup()
        stateRef.current.cleanup = null
      }
    }
  }, [])

  // Return cached nodes for direct signal access
  return stateRef.current.nodes
}

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

export function buildData(count: number): RowData[] {
  const data: RowData[] = new Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: idCounter++,
      label: `${adjectives[_random(adjectives.length)]} ${
        colours[_random(colours.length)]
      } ${nouns[_random(nouns.length)]}`,
    }
  }
  return data
}

// --- TypeScript Definitions ---

export interface RowData {
  id: number
  label: string
}

export interface AppState {
  data: RowData[]
  selected: number | null
}

export interface RowProps {
  item: RowData
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}

// --- Store ---

const [store] = createStore<AppState>({
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

if (typeof window !== 'undefined' && document.getElementById('run')) {
  document.getElementById('run')!.addEventListener('click', () => run(1000))
  document.getElementById('runlots')!.addEventListener('click', () => run(10000))
  document.getElementById('add')!.addEventListener('click', add)
  document.getElementById('update')!.addEventListener('click', update)
  document.getElementById('clear')!.addEventListener('click', clear)
  document.getElementById('swaprows')!.addEventListener('click', swapRows)
}

// --- React Components ---

// Row is memoized — receives plain values as props, no signal reads needed
export const Row: FC<RowProps> = memo(
  ({ item, isSelected, onSelect, onRemove }) => {
    return (
      <tr className={isSelected ? 'danger' : ''}>
        <td className="col-md-1">{item.id}</td>
        <td className="col-md-4">
          <a onClick={() => onSelect(item.id)}>{item.label}</a>
        </td>
        <td className="col-md-1">
          <a onClick={() => onRemove(item.id)}>
            <span
              className="glyphicon glyphicon-remove"
              aria-hidden="true"
            ></span>
          </a>
        </td>
        <td className="col-md-6"></td>
      </tr>
    )
  }
)

export const App = memo(() => {
  const handleSelect = useCallback((id: number) => select(id), [])
  const handleRemove = useCallback((id: number) => remove(id), [])

  // "Compiled" read: useCompiled returns cached $NODE map
  // Signal reads subscribe to the component's effect
  const nodes = useCompiled(store)
  const data: RowData[] = nodes['data']()
  const selected: number | null = nodes['selected']()

  return (
    <For each={data}>
      {(item: RowData) => (
        <Row
          key={item.id}
          item={item}
          isSelected={selected === item.id}
          onSelect={handleSelect}
          onRemove={handleRemove}
        />
      )}
    </For>
  )
})

if (typeof window !== 'undefined' && document.getElementById('tbody')) {
  const container = document.getElementById('tbody')
  const root = createRoot(container!)
  root.render((<App />) as any)
}
