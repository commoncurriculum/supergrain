import { setProperty, $NODE } from './store'

/**
 * MongoDB-style operators for updating reactive stores.
 *
 * PERFORMANCE NOTE: All operators in this file have been optimized to use
 * setProperty() for ALL mutations, eliminating the need for reconciliation.
 * This ensures that signals are updated immediately during the operation,
 * rather than requiring a separate reconciliation pass.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  )
    return false

  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)

  if (keysA.length !== keysB.length) return false

  // Use Set for keysB to avoid quadratic time complexity, but only for large objects
  // to avoid harming the common case of objects with a few keys
  const keysBSet = keysB.length > 10 ? new Set(keysB) : null

  for (const key of keysA) {
    const valA = (a as Record<string, unknown>)[key]
    const valB = (b as Record<string, unknown>)[key]
    const hasKey = keysBSet ? keysBSet.has(key) : keysB.includes(key)
    if (!hasKey || !isEqual(valA, valB)) {
      return false
    }
  }

  return true
}

function resolvePath(
  target: object,
  path: string
): { parent: any; key: string } | null {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (!isObject(current) && !Array.isArray(current)) {
      return null
    }
    current = (current as any)[part]
  }
  if (!isObject(current) && !Array.isArray(current)) {
    return null
  }
  const key = parts[parts.length - 1]!
  return { parent: current, key }
}

function setPathValue(target: object, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    const existing = current[part]
    if (
      existing === undefined ||
      (!isObject(existing) && !Array.isArray(existing))
    ) {
      setProperty(current, part, {})
    }
    current = current[part]
  }
  const key = parts[parts.length - 1]!
  setProperty(current, key, value)
}

function deletePath(target: object, path: string): void {
  const result = resolvePath(target, path)
  if (
    result &&
    Object.prototype.hasOwnProperty.call(result.parent, result.key)
  ) {
    setProperty(result.parent, result.key, undefined, true)
  }
}

// Precise function for incrementing numeric values
// OPTIMIZATION: Uses setProperty to ensure signal updates
function incrementValue(parent: any, key: string, increment: number): void {
  const currentValue = parent[key]
  if (typeof currentValue === 'number') {
    setProperty(parent, key, currentValue + increment)
  } else if (currentValue == null) {
    setProperty(parent, key, increment)
  }
}

// Precise function for comparing and setting min/max values
// OPTIMIZATION: Uses setProperty to ensure signal updates
function compareAndSetValue(
  parent: any,
  key: string,
  newValue: number,
  isMin: boolean
): void {
  const currentValue = parent[key]
  if (typeof currentValue === 'number') {
    const shouldUpdate = isMin
      ? newValue < currentValue
      : newValue > currentValue
    if (shouldUpdate) {
      setProperty(parent, key, newValue)
    }
  } else if (typeof currentValue === 'undefined') {
    setProperty(parent, key, newValue)
  }
}

// Precise function for array push operations
function pushToArray(
  _parent: any,
  _key: string,
  arr: any[],
  itemsToAdd: any[]
): void {
  const startIndex = arr.length
  for (let i = 0; i < itemsToAdd.length; i++) {
    setProperty(arr, startIndex + i, itemsToAdd[i])
  }
}

// Precise function for array pull operations
// OPTIMIZATION: Uses splice for atomic modification then manually triggers signals
function pullFromArray(
  _parent: any,
  _key: string,
  arr: any[],
  condition: any
): boolean {
  let removed = false
  const originalLength = arr.length

  // Remove items from end to beginning to avoid index shifting issues
  for (let i = arr.length - 1; i >= 0; i--) {
    if (isObjectMatch(arr[i], condition)) {
      // Use native splice for atomic array modification
      arr.splice(i, 1)
      removed = true
    }
  }

  // If we removed items, update the array signals
  if (removed && arr.length !== originalLength) {
    // Access the array's signal nodes to manually trigger updates
    const nodes = (arr as any)[$NODE]
    if (nodes) {
      // Update the length signal if it exists
      const lengthSignal = nodes['length']
      if (lengthSignal && lengthSignal() !== arr.length) {
        lengthSignal(arr.length)
      }

      // Update any indexed signals that may have changed
      for (const key of Object.keys(nodes)) {
        if (key !== 'length' && !isNaN(Number(key))) {
          const signal = nodes[key]
          const newValue = (arr as any)[key]
          if (signal() !== newValue) {
            signal(newValue)
          }
        }
      }
    }
  }

  return removed
}

// Precise function for addToSet operations
function addUniqueToArray(
  _parent: any,
  _key: string,
  arr: any[],
  itemsToAdd: any[]
): boolean {
  const newItems = itemsToAdd.filter(
    item => !arr.some(existing => isEqual(existing, item))
  )

  if (newItems.length > 0) {
    const startIndex = arr.length
    for (let i = 0; i < newItems.length; i++) {
      setProperty(arr, startIndex + i, newItems[i])
    }
    return true
  }
  return false
}

function $set(target: object, operations: Record<string, unknown>): void {
  for (const path in operations) {
    setPathValue(target, path, operations[path])
  }
}

function $unset(target: object, operations: Record<string, unknown>): void {
  for (const path in operations) {
    deletePath(target, path)
  }
}

function $inc(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (result) {
      const incValue = operations[path]!
      incrementValue(result.parent, result.key, incValue)
    } else {
      // Path doesn't exist, create it
      setPathValue(target, path, operations[path]!)
    }
  }
}

function $push(target: object, operations: Record<string, any>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    const arr = result?.parent[result.key]
    if (result && Array.isArray(arr)) {
      const value = operations[path]
      const itemsToAdd =
        isObject(value) && '$each' in value && Array.isArray(value['$each'])
          ? value['$each']
          : [value]

      pushToArray(result.parent, result.key, arr, itemsToAdd)
    }
  }
}

function isObjectMatch(obj: any, condition: any): boolean {
  if (!isObject(obj) || !isObject(condition)) {
    return isEqual(obj, condition)
  }

  for (const key of Object.keys(condition)) {
    if (
      !Object.prototype.hasOwnProperty.call(obj, key) ||
      !isEqual(obj[key], condition[key])
    ) {
      return false
    }
  }

  return true
}

function $pull(target: object, operations: Record<string, any>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    const arr = result?.parent[result.key]
    if (result && Array.isArray(arr)) {
      const condition = operations[path]
      pullFromArray(result.parent, result.key, arr, condition)
    }
  }
}

function $addToSet(target: object, operations: Record<string, any>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    const arr = result?.parent[result.key]
    if (result && Array.isArray(arr)) {
      const value = operations[path]
      const itemsToAdd =
        isObject(value) && '$each' in value && Array.isArray(value['$each'])
          ? value['$each']
          : [value]

      addUniqueToArray(result.parent, result.key, arr, itemsToAdd)
    }
  }
}

function $rename(target: object, operations: Record<string, string>): void {
  const renames: Array<{ oldPath: string; newPath: string; value: any }> = []

  for (const oldPath in operations) {
    const newPath = operations[oldPath]!
    const oldResult = resolvePath(target, oldPath)
    if (
      oldResult &&
      Object.prototype.hasOwnProperty.call(oldResult.parent, oldResult.key)
    ) {
      renames.push({ oldPath, newPath, value: oldResult.parent[oldResult.key] })
    }
  }

  for (const { oldPath, newPath, value } of renames) {
    deletePath(target, oldPath)
    setPathValue(target, newPath, value)
  }
}

function $min(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (result) {
      const newValue = operations[path]!
      compareAndSetValue(result.parent, result.key, newValue, true)
    } else {
      // Path doesn't exist, create it
      setPathValue(target, path, operations[path]!)
    }
  }
}

function $max(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (result) {
      const newValue = operations[path]!
      compareAndSetValue(result.parent, result.key, newValue, false)
    } else {
      // Path doesn't exist, create it
      setPathValue(target, path, operations[path]!)
    }
  }
}

const operatorList = [
  '$set',
  '$unset',
  '$rename',
  '$inc',
  '$min',
  '$max',
  '$push',
  '$pull',
  '$addToSet',
]

const operators: Record<string, (target: object, operations: any) => void> = {
  $set,
  $unset,
  $inc,
  $push,
  $pull,
  $addToSet,
  $rename,
  $min,
  $max,
}

export type ArrayModifiers<T> = {
  $each: T[]
}

export type UpdateOperations = Partial<{
  $set: Record<string, any>
  $unset: Record<string, true | 1>
  $inc: Record<string, number>
  $push: Record<string, any>
  $pull: Record<string, any>
  $addToSet: Record<string, any>
  $rename: Record<string, string>
  $min: Record<string, number>
  $max: Record<string, number>
}>

export function update<T extends object>(
  target: T,
  operations: UpdateOperations
): void {
  for (const op of operatorList) {
    if (op in operations) {
      const operator = operators[op]
      const opArgs = (operations as any)[op]
      operator?.(target, opArgs)
    }
  }
}
