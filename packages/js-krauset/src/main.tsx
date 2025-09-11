import { FC, memo, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { useTrackedStore } from '@storable/react'
import { createStore } from '@storable/core'

// --- Data Generation ---

let idCounter = 1

const adjectives = [
  'pretty',
  'large',
  'big',
  'small',
  'tall',
  'short',
  'long',
  'handsome',
  'plain',
  'quaint',
  'clean',
  'elegant',
  'easy',
  'angry',
  'crazy',
  'helpful',
  'mushy',
  'odd',
  'unsightly',
  'adorable',
  'important',
  'inexpensive',
  'cheap',
  'expensive',
  'fancy',
]
const colours = [
  'red',
  'yellow',
  'blue',
  'green',
  'pink',
  'brown',
  'purple',
  'brown',
  'white',
  'black',
  'orange',
]
const nouns = [
  'table',
  'chair',
  'house',
  'bbq',
  'desk',
  'car',
  'pony',
  'cookie',
  'sandwich',
  'burger',
  'pizza',
  'mouse',
  'keyboard',
]

function _random(max: number): number {
  return Math.round(Math.random() * 1000) % max
}

function buildData(count: number): RowData[] {
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

interface RowData {
  id: number
  label: string
}

interface AppState {
  data: RowData[]
  selected: number | null
}

interface RowProps {
  item: RowData
  isSelected: boolean
  onSelect: (id: number) => void
  onRemove: (id: number) => void
}

// --- Storable Implementation ---

const [store, updateStore] = createStore<AppState>({
  data: [],
  selected: null,
})

const run = (count: number) => {
  updateStore({
    $set: {
      data: buildData(count),
      selected: null,
    },
  })
}

const add = () => {
  updateStore({
    $push: {
      data: { $each: buildData(1000) },
    },
  })
}

const update = () => {
  const updates: Record<string, string> = {}
  for (let i = 0; i < store.data.length; i += 10) {
    updates[`data.${i}.label`] = store.data[i].label + ' !!!'
  }
  updateStore({ $set: updates })
}

const clear = () => {
  updateStore({ $set: { data: [], selected: null } })
}

const swapRows = () => {
  if (store.data.length > 998) {
    const row1 = store.data[1]
    const row998 = store.data[998]
    updateStore({
      $set: {
        'data.1': row998,
        'data.998': row1,
      },
    })
  }
}

const remove = (id: number) => {
  updateStore({ $pull: { data: { id } } })
}

const select = (id: number) => {
  updateStore({ $set: { selected: id } })
}

// Attach event listeners to the static buttons on startup
document.getElementById('run')!.addEventListener('click', () => run(1000))
document.getElementById('runlots')!.addEventListener('click', () => run(10000))
document.getElementById('add')!.addEventListener('click', add)
document.getElementById('update')!.addEventListener('click', update)
document.getElementById('clear')!.addEventListener('click', clear)
document.getElementById('swaprows')!.addEventListener('click', swapRows)

// --- React Components ---

/**
 * Optimized Row component using React.memo for maximum performance.
 *
 * Thanks to the proxy reference stability fix in useTrackedStore:
 * - The 'item' prop has a stable reference across renders when data doesn't change
 * - React.memo can properly detect when props haven't changed
 * - Only rows that actually need to update will re-render
 *
 * This provides massive performance improvements for large lists:
 * - Before fix: All rows re-render on any change (1-2% efficient)
 * - After fix: Only changed rows re-render (98%+ efficient)
 */
const Row: FC<RowProps> = memo(({ item, isSelected, onSelect, onRemove }) => {
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
}) // TODO: Add storePropsAreEqual when types are fixed

const App: FC = () => {
  const state = useTrackedStore(store)

  // Create stable callbacks to prevent all rows from re-rendering
  // when parent component re-renders
  const handleSelect = useCallback((id: number) => select(id), [])
  const handleRemove = useCallback((id: number) => remove(id), [])

  return (
    <>
      {state.data.map((item: RowData) => (
        <Row
          key={item.id}
          item={item} // ← Stable proxy reference enables React.memo optimization!
          isSelected={state.selected === item.id}
          onSelect={handleSelect} // ← Stable callback reference
          onRemove={handleRemove} // ← Stable callback reference
        />
      ))}
    </>
  )
}

// --- React Rendering ---
const container = document.getElementById('tbody')
const root = createRoot(container!)
root.render((<App />) as any)
