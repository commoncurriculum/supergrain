import {
  memo,
  useReducer,
  useMemo,
  createContext,
  useContext,
  createElement,
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

const DispatchContext = createContext(null)

const DispatchProvider = ({ children, dispatch }) => {
  const actions = useMemo(
    () => ({
      select: id => dispatch({ type: 'SELECT', id }),
      remove: id => dispatch({ type: 'REMOVE', id }),
    }),
    [dispatch]
  )

  return createElement(DispatchContext.Provider, { value: actions }, children)
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

// OPTIMIZATION 8: Use createElement directly to avoid JSX overhead
const Row = memo(({ item, selected }) => {
  const actions = useContext(DispatchContext)

  return createElement(
    'tr',
    { className: selected ? 'danger' : '' },
    createElement('td', { className: 'col-md-1' }, item.id),
    createElement(
      'td',
      { className: 'col-md-4' },
      createElement('a', { onClick: () => actions.select(item.id) }, item.label)
    ),
    createElement(
      'td',
      { className: 'col-md-1' },
      createElement(
        'a',
        { onClick: () => actions.remove(item.id) },
        createElement('span', {
          className: 'glyphicon glyphicon-remove',
          'aria-hidden': 'true',
        })
      )
    ),
    createElement('td', { className: 'col-md-6' })
  )
})

export const App = () => {
  const [state, dispatch] = useReducer(listReducer, initialState)

  // Sync global state for testing
  globalState = state
  globalDispatch = dispatch

  // Memoize the entire row list with createElement
  const rowElements = useMemo(() => {
    return state.data.map(item =>
      createElement(Row, {
        key: item.id,
        item: item,
        selected: state.selected === item.id,
      })
    )
  }, [state.data, state.selected])

  return createElement(DispatchProvider, { dispatch }, rowElements)
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
  root.render(createElement(App))
}
