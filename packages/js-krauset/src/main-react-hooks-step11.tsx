import {
  memo,
  useReducer,
  useMemo,
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from 'react'
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
      const newData = data.slice(0)
      for (let i = 0; i < newData.length; i += 10) {
        newData[i] = { ...newData[i], label: newData[i].label + ' !!!' }
      }
      return { data: newData, selected }
    }
    case 'CLEAR':
      return { data: [], selected: 0 }
    case 'SWAPROWS': {
      return data.length > 998
        ? {
            data: [
              data[0],
              data[998],
              ...data.slice(2, 998),
              data[1],
              ...data.slice(999),
            ],
            selected,
          }
        : state
    }
    case 'REMOVE': {
      const idx = data.findIndex(d => d.id === action.id)
      return { data: [...data.slice(0, idx), ...data.slice(idx + 1)], selected }
    }
    case 'SELECT':
      return { data, selected: action.id }
  }
  return state
}

// OPTIMIZATION 10: Subscription-based updates - each row subscribes to its specific data
class RowDataStore {
  constructor() {
    this.data = new Map() // id -> item data
    this.selected = null
    this.subscribers = new Map() // id -> Set of callbacks
    this.selectedSubscribers = new Set()
  }

  setData(newData) {
    // Clear old data
    this.data.clear()
    // Set new data and notify all subscribers
    newData.forEach(item => {
      this.data.set(item.id, item)
    })
    // Notify all row subscribers of potential changes
    this.subscribers.forEach((callbacks, id) => {
      callbacks.forEach(callback => callback(this.data.get(id)))
    })
  }

  updateItem(id, newItem) {
    this.data.set(id, newItem)
    const callbacks = this.subscribers.get(id)
    if (callbacks) {
      callbacks.forEach(callback => callback(newItem))
    }
  }

  setSelected(selectedId) {
    this.selected = selectedId
    this.selectedSubscribers.forEach(callback => callback(selectedId))
  }

  subscribeToItem(id, callback) {
    if (!this.subscribers.has(id)) {
      this.subscribers.set(id, new Set())
    }
    this.subscribers.get(id).add(callback)

    return () => {
      const callbacks = this.subscribers.get(id)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.subscribers.delete(id)
        }
      }
    }
  }

  subscribeToSelected(callback) {
    this.selectedSubscribers.add(callback)
    return () => this.selectedSubscribers.delete(callback)
  }

  removeItem(id) {
    this.data.delete(id)
    const callbacks = this.subscribers.get(id)
    if (callbacks) {
      callbacks.forEach(callback => callback(null)) // Signal removal
    }
    this.subscribers.delete(id)
  }

  swapItems(id1, id2) {
    const item1 = this.data.get(id1)
    const item2 = this.data.get(id2)
    if (item1 && item2) {
      this.data.set(id1, item2)
      this.data.set(id2, item1)

      const callbacks1 = this.subscribers.get(id1)
      const callbacks2 = this.subscribers.get(id2)

      if (callbacks1) {
        callbacks1.forEach(callback => callback(item2))
      }
      if (callbacks2) {
        callbacks2.forEach(callback => callback(item1))
      }
    }
  }
}

const rowDataStore = new RowDataStore()

const DispatchContext = createContext(null)

const DispatchProvider = ({ children, dispatch }) => {
  const actions = useMemo(
    () => ({
      select: id => {
        dispatch({ type: 'SELECT', id })
        rowDataStore.setSelected(id)
      },
      remove: id => {
        dispatch({ type: 'REMOVE', id })
        rowDataStore.removeItem(id)
      },
    }),
    [dispatch]
  )

  return (
    <DispatchContext.Provider value={actions}>
      {children}
    </DispatchContext.Provider>
  )
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
      rowDataStore.setData(setOps.data)
      rowDataStore.setSelected(setOps.selected)
      return
    }
    if ('selected' in setOps) {
      globalDispatch({ type: 'SELECT', id: setOps.selected })
      rowDataStore.setSelected(setOps.selected)
      return
    }
    // Handle update operations - update specific items
    if (
      Object.keys(setOps).some(
        key => key.includes('data.') && key.includes('.label')
      )
    ) {
      globalDispatch({ type: 'UPDATE' })
      // Update specific items in the store
      globalState.data.forEach((item, index) => {
        if (index % 10 === 0) {
          const updatedItem = { ...item, label: item.label + ' !!!' }
          rowDataStore.updateItem(item.id, updatedItem)
        }
      })
      return
    }
    // Handle swap operations
    if ('data.1' in setOps && 'data.998' in setOps) {
      globalDispatch({ type: 'SWAPROWS' })
      const item1 = globalState.data[1]
      const item998 = globalState.data[998]
      if (item1 && item998) {
        rowDataStore.swapItems(item1.id, item998.id)
      }
      return
    }
  }
  if ('$pull' in updates) {
    const pullOps = updates.$pull
    if ('data' in pullOps && 'id' in pullOps.data) {
      globalDispatch({ type: 'REMOVE', id: pullOps.data.id })
      rowDataStore.removeItem(pullOps.data.id)
      return
    }
  }
}

// Each row subscribes only to its specific data changes
const Row = memo(({ itemId, initialItem }) => {
  const [item, setItem] = useState(initialItem)
  const [isSelected, setIsSelected] = useState(false)
  const actions = useContext(DispatchContext)

  useEffect(() => {
    const unsubscribeItem = rowDataStore.subscribeToItem(itemId, newItem => {
      if (newItem) {
        setItem(newItem)
      }
    })

    const unsubscribeSelected = rowDataStore.subscribeToSelected(selectedId => {
      setIsSelected(selectedId === itemId)
    })

    return () => {
      unsubscribeItem()
      unsubscribeSelected()
    }
  }, [itemId])

  if (!item) return null // Item was removed

  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => actions.select(item.id)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => actions.remove(item.id)}>
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

  // Only re-render when the data structure changes (add/remove items)
  const rowElements = useMemo(() => {
    return state.data.map(item => (
      <Row key={item.id} itemId={item.id} initialItem={item} />
    ))
  }, [state.data.map(item => item.id).join(',')]) // Only depend on IDs, not content

  return <DispatchProvider dispatch={dispatch}>{rowElements}</DispatchProvider>
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
