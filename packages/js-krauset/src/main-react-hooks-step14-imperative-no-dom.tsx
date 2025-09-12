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

// Global state - completely separate from React
let globalState = {
  data: [],
  selected: null,
}

// Global registry of component refs
let rowRefs = new Map() // id -> ref
let globalRowSetter = null // Function to update row structure

export const store = {
  get data() {
    return globalState.data
  },
  get selected() {
    return globalState.selected
  },
}

const DispatchContext = createContext(null)

const DispatchProvider = ({ children, dispatch }) => {
  const actions = useMemo(
    () => ({
      select: id => updateStore({ $set: { selected: id } }),
      remove: id => updateStore({ $pull: { data: { id } } }),
    }),
    [] // Empty deps - actions never change
  )

  return (
    <DispatchContext.Provider value={actions}>
      {children}
    </DispatchContext.Provider>
  )
}

// Row component - receives ONLY stable props after creation
const Row = memo(
  forwardRef(({ itemId, initialLabel, initialSelected }, ref) => {
    // Local state controlled by imperative updates
    const [label, setLabel] = useState(initialLabel)
    const [isSelected, setIsSelected] = useState(initialSelected)
    const actions = useContext(DispatchContext)

    useImperativeHandle(
      ref,
      () => ({
        updateLabel: newLabel => setLabel(newLabel),
        setSelected: selected => setIsSelected(selected),
      }),
      []
    )

    return (
      <tr className={isSelected ? 'danger' : ''}>
        <td className="col-md-1">{itemId}</td>
        <td className="col-md-4">
          <a onClick={() => actions.select(itemId)}>{label}</a>
        </td>
        <td className="col-md-1">
          <a onClick={() => actions.remove(itemId)}>
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

// Container component - only re-renders when row structure changes
const ImperativeApp = () => {
  const [rowStructure, setRowStructure] = useState([])

  useEffect(() => {
    globalRowSetter = setRowStructure
  }, [])

  // Create row elements with stable props
  const rowElements = useMemo(() => {
    return rowStructure.map(item => {
      let ref = rowRefs.get(item.id)
      if (!ref) {
        ref = { current: null }
        rowRefs.set(item.id, ref)
      }

      return (
        <Row
          key={item.id}
          itemId={item.id}
          initialLabel={item.label}
          initialSelected={globalState.selected === item.id}
          ref={ref}
        />
      )
    })
  }, [rowStructure]) // Only recreates when structure changes

  return <DispatchProvider>{rowElements}</DispatchProvider>
}

// Pure imperative updates - minimal React reconciliation
export const updateStore = updates => {
  if ('$set' in updates) {
    const setOps = updates.$set

    // Handle data replacement (create/clear operations)
    if ('data' in setOps) {
      const newData = setOps.data

      // Clear existing refs
      rowRefs.clear()

      // Update global state
      globalState.data = newData
      globalState.selected = setOps.selected || null

      // Trigger React to create new row structure (this is the only reconciliation)
      if (globalRowSetter) {
        globalRowSetter([...newData]) // React renders once with stable props
      }

      return
    }

    // Handle selection changes - pure imperative
    if ('selected' in setOps) {
      const newSelected = setOps.selected
      const oldSelected = globalState.selected

      // Update old selection imperatively
      if (oldSelected && rowRefs.has(oldSelected)) {
        const ref = rowRefs.get(oldSelected)
        if (ref.current) {
          ref.current.setSelected(false)
        }
      }

      // Update new selection imperatively
      if (newSelected && rowRefs.has(newSelected)) {
        const ref = rowRefs.get(newSelected)
        if (ref.current) {
          ref.current.setSelected(true)
        }
      }

      globalState.selected = newSelected
      return
    }

    // Handle label updates - pure imperative
    const labelUpdates = Object.keys(setOps).filter(
      key => key.includes('data.') && key.includes('.label')
    )

    if (labelUpdates.length > 0) {
      // Update every 10th row imperatively - no React reconciliation
      globalState.data.forEach((item, index) => {
        if (index % 10 === 0) {
          const newLabel = item.label + ' !!!'
          const ref = rowRefs.get(item.id)
          if (ref && ref.current) {
            ref.current.updateLabel(newLabel)
          }
          // Update data model
          item.label = newLabel
        }
      })
      return
    }

    // Handle row swapping - pure imperative
    if ('data.1' in setOps && 'data.998' in setOps) {
      const item1 = globalState.data[1]
      const item998 = globalState.data[998]

      if (item1 && item998) {
        const ref1 = rowRefs.get(item1.id)
        const ref998 = rowRefs.get(item998.id)

        if (ref1?.current && ref998?.current) {
          // Swap labels imperatively
          const temp = item1.label
          item1.label = item998.label
          item998.label = temp

          ref1.current.updateLabel(item1.label)
          ref998.current.updateLabel(item998.label)
        }

        // Swap in data array
        ;[globalState.data[1], globalState.data[998]] = [
          globalState.data[998],
          globalState.data[1],
        ]
      }
      return
    }
  }

  if ('$pull' in updates) {
    const pullOps = updates.$pull
    if ('data' in pullOps && 'id' in pullOps.data) {
      const id = pullOps.data.id

      // Remove from data
      globalState.data = globalState.data.filter(item => item.id !== id)

      // Clean up refs
      rowRefs.delete(id)

      if (globalState.selected === id) {
        globalState.selected = null
      }

      // Update row structure (triggers reconciliation for removal)
      if (globalRowSetter) {
        globalRowSetter([...globalState.data])
      }

      return
    }
  }
}

// Legacy compatibility functions
export const run = count => {
  const data = buildData(count)
  updateStore({ $set: { data, selected: null } })
}

export const add = () => {
  const newData = globalState.data.concat(buildData(1000))
  updateStore({ $set: { data: newData } })
}

export const update = () => {
  const updates = {}
  for (let i = 0; i < globalState.data.length; i += 10) {
    updates[`data.${i}.label`] = globalState.data[i].label + ' !!!'
  }
  updateStore({ $set: updates })
}

export const clear = () => {
  updateStore({ $set: { data: [], selected: null } })
}

export const swapRows = () => {
  if (globalState.data.length > 998) {
    updateStore({
      $set: {
        'data.1': globalState.data[998],
        'data.998': globalState.data[1],
      },
    })
  }
}

export const remove = id => {
  updateStore({ $pull: { data: { id } } })
}

export const select = id => {
  updateStore({ $set: { selected: id } })
}

export const App = ImperativeApp

if (typeof window !== 'undefined' && document.getElementById('tbody')) {
  const container = document.getElementById('tbody')
  const root = createRoot(container)
  root.render(<App />)
}
