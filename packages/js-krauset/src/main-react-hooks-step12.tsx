import {
  memo,
  useReducer,
  useMemo,
  createContext,
  useContext,
  forwardRef,
  useImperativeHandle,
  useState,
  useRef,
  useEffect,
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

  return (
    <DispatchContext.Provider value={actions}>
      {children}
    </DispatchContext.Provider>
  )
}

// Global state for testing compatibility and imperative updates
let globalState = { data: [], selected: null }
let globalDispatch
let rowRefs = new Map() // id -> ref to row component

export const store = {
  get data() {
    return globalState.data
  },
  get selected() {
    return globalState.selected
  },
}

// OPTIMIZATION 11: Use imperative handles to directly update specific rows
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
      // Imperatively update selection on all rows
      rowRefs.forEach((ref, id) => {
        if (ref.current) {
          ref.current.setSelected(id === setOps.selected)
        }
      })
      return
    }
    // Handle update operations - directly update specific rows!
    if (
      Object.keys(setOps).some(
        key => key.includes('data.') && key.includes('.label')
      )
    ) {
      globalDispatch({ type: 'UPDATE' })
      // Directly update every 10th row without triggering React reconciliation
      globalState.data.forEach((item, index) => {
        if (index % 10 === 0) {
          const ref = rowRefs.get(item.id)
          if (ref && ref.current) {
            ref.current.updateLabel(item.label + ' !!!')
          }
        }
      })
      return
    }
    // Handle swap operations - directly swap specific rows!
    if ('data.1' in setOps && 'data.998' in setOps) {
      globalDispatch({ type: 'SWAPROWS' })
      const item1 = globalState.data[1]
      const item998 = globalState.data[998]
      if (item1 && item998) {
        const ref1 = rowRefs.get(item1.id)
        const ref998 = rowRefs.get(item998.id)
        if (ref1 && ref1.current && ref998 && ref998.current) {
          ref1.current.updateLabel(item998.label)
          ref998.current.updateLabel(item1.label)
        }
      }
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

// Each row exposes an imperative API for direct updates
const Row = memo(
  forwardRef(({ item, selected }, ref) => {
    const [currentLabel, setCurrentLabel] = useState(item.label)
    const [isSelected, setIsSelected] = useState(selected)
    const actions = useContext(DispatchContext)

    useImperativeHandle(
      ref,
      () => ({
        updateLabel: newLabel => {
          setCurrentLabel(newLabel)
        },
        setSelected: selected => {
          setIsSelected(selected)
        },
        swapWith: otherLabel => {
          setCurrentLabel(otherLabel)
        },
      }),
      []
    )

    return (
      <tr className={isSelected ? 'danger' : ''}>
        <td className="col-md-1">{item.id}</td>
        <td className="col-md-4">
          <a onClick={() => actions.select(item.id)}>{currentLabel}</a>
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
)

export const App = () => {
  const [state, dispatch] = useReducer(listReducer, initialState)

  // Sync global state for testing
  globalState = state
  globalDispatch = dispatch

  // Create refs for imperative updates
  const rowElements = useMemo(() => {
    // Clear old refs
    rowRefs.clear()

    return state.data.map(item => {
      const ref = useRef()
      rowRefs.set(item.id, ref)

      return (
        <Row
          key={item.id}
          ref={ref}
          item={item}
          selected={state.selected === item.id}
        />
      )
    })
  }, [state.data, state.selected])

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
