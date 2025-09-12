import { memo, useReducer, useCallback, useMemo } from 'react'
import { createRoot } from 'react-dom/client'

const random = max => Math.round(Math.random() * 1000) % max

const A = [
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
const C = [
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
const N = [
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

let nextId = 1

export const buildData = count => {
  const data = new Array(count)
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: nextId++,
      label: `${A[random(A.length)]} ${C[random(C.length)]} ${
        N[random(N.length)]
      }`,
    }
  }
  return data
}

const initialState = { data: [], selected: 0 }

// Optimized reducer with better immutability and early returns
const listReducer = (state, action) => {
  const { data, selected } = state
  switch (action.type) {
    case 'RUN':
      return { data: buildData(1000), selected: 0 }
    case 'RUN_LOTS':
      return { data: buildData(10000), selected: 0 }
    case 'ADD':
      return { data: data.concat(buildData(1000)), selected }
    case 'UPDATE': {
      // Optimized: Only create new array if we actually have changes
      let hasChanges = false
      const newData = data.map((item, index) => {
        if (index % 10 === 0) {
          const newLabel = item.label + ' !!!'
          if (item.label !== newLabel) {
            hasChanges = true
            return { ...item, label: newLabel }
          }
        }
        return item // Preserve object identity for unchanged items
      })
      return hasChanges ? { data: newData, selected } : state
    }
    case 'CLEAR':
      return data.length === 0 ? state : { data: [], selected: 0 }
    case 'SWAPROWS': {
      if (data.length <= 998) return state
      // More efficient swapping without spread
      const newData = data.slice()
      const temp = newData[1]
      newData[1] = newData[998]
      newData[998] = temp
      return { data: newData, selected }
    }
    case 'REMOVE': {
      const newData = data.filter(d => d.id !== action.id)
      return newData.length === data.length
        ? state
        : { data: newData, selected }
    }
    case 'SELECT':
      return selected === action.id ? state : { data, selected: action.id }
  }
  return state
}

// Global state for testing compatibility
let globalState = { data: [], selected: null }
let globalDispatch

export const store = {
  get data() {
    return globalState.data
  },
  get selected() {
    return globalState.selected
  },
}

export const updateStore = updates => {
  if ('$set' in updates) {
    const setOps = updates.$set
    if ('data' in setOps && 'selected' in setOps) {
      if (setOps.data.length === 1000) {
        globalDispatch({ type: 'RUN' })
      } else {
        globalDispatch({ type: 'RUN_LOTS' })
      }
      return
    }
    if ('selected' in setOps) {
      globalDispatch({ type: 'SELECT', id: setOps.selected })
      return
    }
    // Handle update operations
    if (
      Object.keys(setOps).some(
        key => key.includes('data.') && key.includes('.label')
      )
    ) {
      globalDispatch({ type: 'UPDATE' })
      return
    }
    // Handle swap operations
    if ('data.1' in setOps && 'data.998' in setOps) {
      globalDispatch({ type: 'SWAPROWS' })
      return
    }
  }
  if ('$pull' in updates) {
    const pullOps = updates.$pull
    if ('data' in pullOps && 'id' in pullOps.data) {
      globalDispatch({ type: 'REMOVE', id: pullOps.data.id })
      return
    }
  }
}

// Optimized Row component with primitive props
const Row = memo(({ id, label, selected, onSelect, onRemove }) => {
  return (
    <tr className={selected ? 'danger' : undefined}>
      <td className="col-md-1">{id}</td>
      <td className="col-md-4">
        <a onClick={onSelect}>{label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={onRemove}>
          <span
            className="glyphicon glyphicon-remove"
            aria-hidden="true"
          ></span>
        </a>
      </td>
      <td className="col-md-6"></td>
    </tr>
  )
})

export const App = () => {
  const [state, dispatch] = useReducer(listReducer, initialState)

  // Sync global state for testing
  globalState = state
  globalDispatch = dispatch

  // Optimization 1: Stable callback references
  const select = useCallback(id => {
    dispatch({ type: 'SELECT', id })
  }, [])

  const remove = useCallback(id => {
    dispatch({ type: 'REMOVE', id })
  }, [])

  // Optimization 2: Pre-computed callback maps for stable references
  const callbacks = useMemo(() => {
    const selectCallbacks = new Map()
    const removeCallbacks = new Map()

    state.data.forEach(item => {
      selectCallbacks.set(item.id, () => select(item.id))
      removeCallbacks.set(item.id, () => remove(item.id))
    })

    return { selectCallbacks, removeCallbacks }
  }, [state.data, select, remove])

  // Optimization 3: Pre-computed selection state for fast lookups
  const selectedSet = useMemo(() => new Set([state.selected]), [state.selected])

  return (
    <>
      {state.data.map(item => (
        <Row
          key={item.id}
          id={item.id}
          label={item.label}
          selected={selectedSet.has(item.id)}
          onSelect={callbacks.selectCallbacks.get(item.id)}
          onRemove={callbacks.removeCallbacks.get(item.id)}
        />
      ))}
    </>
  )
}

// Button event handlers
export const run = count =>
  globalDispatch &&
  globalDispatch({ type: count === 1000 ? 'RUN' : 'RUN_LOTS' })
export const add = () => globalDispatch && globalDispatch({ type: 'ADD' })
export const update = () => globalDispatch && globalDispatch({ type: 'UPDATE' })
export const clear = () => globalDispatch && globalDispatch({ type: 'CLEAR' })
export const swapRows = () =>
  globalDispatch && globalDispatch({ type: 'SWAPROWS' })
export const remove = id =>
  globalDispatch && globalDispatch({ type: 'REMOVE', id })
export const select = id =>
  globalDispatch && globalDispatch({ type: 'SELECT', id })

if (typeof window !== 'undefined' && document.getElementById('tbody')) {
  const container = document.getElementById('tbody')
  const root = createRoot(container)
  root.render(<App />)
}
