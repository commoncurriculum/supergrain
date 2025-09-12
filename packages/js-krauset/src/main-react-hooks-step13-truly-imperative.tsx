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

export const store = {
  get data() {
    return globalState.data
  },
  get selected() {
    return globalState.selected
  },
}

// Container component - renders once, never re-renders
const TrulyImperativeApp = () => {
  // This never changes - React never re-renders this component
  // Return empty fragment since we'll be appending directly to tbody
  return <></>
}

// Imperative row creation - bypasses React entirely after initial mount
function createRow(item) {
  // Create row element imperatively
  const rowElement = document.createElement('tr')
  rowElement.className = ''

  // Create cells
  const idCell = document.createElement('td')
  idCell.className = 'col-md-1'
  idCell.textContent = item.id

  const labelCell = document.createElement('td')
  labelCell.className = 'col-md-4'
  const labelLink = document.createElement('a')
  labelLink.textContent = item.label
  labelLink.onclick = () => updateStore({ $set: { selected: item.id } })
  labelCell.appendChild(labelLink)

  const removeCell = document.createElement('td')
  removeCell.className = 'col-md-1'
  const removeLink = document.createElement('a')
  const removeSpan = document.createElement('span')
  removeSpan.className = 'glyphicon glyphicon-remove'
  removeSpan.setAttribute('aria-hidden', 'true')
  removeLink.appendChild(removeSpan)
  removeLink.onclick = () => updateStore({ $pull: { data: { id: item.id } } })
  removeCell.appendChild(removeLink)

  const spacerCell = document.createElement('td')
  spacerCell.className = 'col-md-6'

  rowElement.appendChild(idCell)
  rowElement.appendChild(labelCell)
  rowElement.appendChild(removeCell)
  rowElement.appendChild(spacerCell)

  // Create imperative API
  const imperativeAPI = {
    updateLabel: newLabel => {
      labelLink.textContent = newLabel
    },
    setSelected: selected => {
      rowElement.className = selected ? 'danger' : ''
    },
    remove: () => {
      if (rowElement.parentNode) {
        rowElement.parentNode.removeChild(rowElement)
      }
    },
    getElement: () => rowElement,
  }

  return { element: rowElement, api: imperativeAPI }
}

// Pure imperative updates - NO React reconciliation
export const updateStore = updates => {
  if ('$set' in updates) {
    const setOps = updates.$set

    // Handle data replacement (create/clear operations)
    if ('data' in setOps) {
      const newData = setOps.data

      // Clear existing rows
      rowRefs.forEach(ref => {
        if (ref.api) {
          ref.api.remove()
        }
      })
      rowRefs.clear()

      // Get container - use the tbody element directly
      const container = document.getElementById('tbody')
      if (!container) return

      // Create new rows imperatively - NO React involved
      newData.forEach(item => {
        const { element, api } = createRow(item)

        // Initialize with data
        api.updateLabel(item.label)
        api.setSelected(false)

        // Store references
        rowRefs.set(item.id, { api, element })

        // Add to DOM
        container.appendChild(element)
      })

      // Update global state
      globalState.data = newData
      globalState.selected = setOps.selected || null
      return
    }

    // Handle selection changes - pure imperative
    if ('selected' in setOps) {
      const newSelected = setOps.selected
      const oldSelected = globalState.selected

      // Update old selection
      if (oldSelected && rowRefs.has(oldSelected)) {
        rowRefs.get(oldSelected).api.setSelected(false)
      }

      // Update new selection
      if (newSelected && rowRefs.has(newSelected)) {
        rowRefs.get(newSelected).api.setSelected(true)
      }

      globalState.selected = newSelected
      return
    }

    // Handle label updates - pure imperative
    const labelUpdates = Object.keys(setOps).filter(
      key => key.includes('data.') && key.includes('.label')
    )

    if (labelUpdates.length > 0) {
      // Update every 10th row directly
      globalState.data.forEach((item, index) => {
        if (index % 10 === 0) {
          const newLabel = item.label + ' !!!'
          const ref = rowRefs.get(item.id)
          if (ref?.api) {
            ref.api.updateLabel(newLabel)
          }
          // Update our data model
          item.label = newLabel
        }
      })
      return
    }

    // Handle row swapping
    if ('data.1' in setOps && 'data.998' in setOps) {
      const item1 = globalState.data[1]
      const item998 = globalState.data[998]

      if (item1 && item998) {
        const ref1 = rowRefs.get(item1.id)
        const ref998 = rowRefs.get(item998.id)

        if (ref1?.api && ref998?.api) {
          // Swap labels imperatively
          const temp = item1.label
          item1.label = item998.label
          item998.label = temp

          ref1.api.updateLabel(item1.label)
          ref998.api.updateLabel(item998.label)
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
      const ref = rowRefs.get(id)

      if (ref?.api) {
        // Remove from DOM
        ref.api.remove()

        // Clean up references
        rowRefs.delete(id)

        // Update global state
        globalState.data = globalState.data.filter(item => item.id !== id)

        if (globalState.selected === id) {
          globalState.selected = null
        }
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

export const App = TrulyImperativeApp

if (typeof window !== 'undefined' && document.getElementById('tbody')) {
  const container = document.getElementById('tbody')
  const root = createRoot(container)
  root.render(<App />)
}
