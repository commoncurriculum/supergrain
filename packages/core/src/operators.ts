import { setProperty } from './store'

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

  for (const key of keysA) {
    const valA = (a as Record<string, unknown>)[key]
    const valB = (b as Record<string, unknown>)[key]
    if (!keysB.includes(key) || !isEqual(valA, valB)) {
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
    const value = current[part]
    if (value === undefined || (!isObject(value) && !Array.isArray(value))) {
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
      const currentValue = result.parent[result.key]
      const incValue = operations[path]!
      if (typeof currentValue === 'number') {
        setProperty(result.parent, result.key, currentValue + incValue)
      } else if (currentValue == null) {
        setPathValue(target, path, incValue)
      }
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
      const newArr = [...arr, ...itemsToAdd]
      setProperty(result.parent, result.key, newArr)
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
      const newArr = arr.filter((item: any) => !isObjectMatch(item, condition))
      if (newArr.length < arr.length) {
        setProperty(result.parent, result.key, newArr)
      }
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

      const newItems = itemsToAdd.filter(
        item => !arr.some(existing => isEqual(existing, item))
      )

      if (newItems.length > 0) {
        setProperty(result.parent, result.key, [...arr, ...newItems])
      }
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
      const currentValue = result.parent[result.key]
      const newValue = operations[path]!
      if (typeof currentValue === 'number' && newValue < currentValue) {
        setProperty(result.parent, result.key, newValue)
      } else if (typeof currentValue === 'undefined') {
        setPathValue(target, path, newValue)
      }
    }
  }
}

function $max(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (result) {
      const currentValue = result.parent[result.key]
      const newValue = operations[path]!
      if (typeof currentValue === 'number' && newValue > currentValue) {
        setProperty(result.parent, result.key, newValue)
      } else if (typeof currentValue === 'undefined') {
        setPathValue(target, path, newValue)
      }
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
