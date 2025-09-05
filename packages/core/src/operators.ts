import { startBatch, endBatch } from 'alien-signals'

// --- Helper Functions ---

/**
 * Checks if a value is a non-null object (and not an array).
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Simple deep equality check for objects and arrays.
 */
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

/**
 * Traverses a path string (e.g., 'user.profile.name') to get the final
 * parent object and the key. Returns null if the path is invalid.
 */
export function resolvePath(
  target: object,
  path: string
): { parent: any; key: string } | null {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!part || (!isObject(current) && !Array.isArray(current))) {
      return null
    }
    current = (current as any)[part]
  }
  if (!isObject(current) && !Array.isArray(current)) {
    return null
  }
  const key = parts[parts.length - 1]
  if (key === undefined) {
    return null
  }
  return { parent: current, key }
}

/**
 * Traverses a path string and sets the value at the end of the path.
 * Creates nested objects if they don't exist.
 */
export function setPath(target: object, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!part) continue
    if (
      (current as any)[part] === undefined ||
      !isObject((current as any)[part])
    ) {
      ;(current as any)[part] = {}
    }
    current = (current as any)[part]
  }
  const key = parts[parts.length - 1]
  if (key) {
    ;(current as any)[key] = value
  }
}

export function deletePath(target: object, path: string): void {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!part || (!isObject(current) && !Array.isArray(current))) {
      return
    }
    current = (current as any)[part]
  }
  const key = parts[parts.length - 1]
  if (key && (isObject(current) || Array.isArray(current))) {
    delete (current as any)[key]
  }
}

// --- Operator Implementations ---

function $set(target: object, operations: Record<string, unknown>): void {
  for (const path in operations) {
    setPath(target, path, operations[path])
  }
}

function $inc(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (
      result &&
      typeof result.parent[result.key] === 'number' &&
      typeof operations[path] === 'number'
    ) {
      result.parent[result.key] += operations[path]
    }
  }
}

function $push(target: object, operations: Record<string, any>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    const arr = result?.parent[result.key]
    if (result && Array.isArray(arr)) {
      const value = operations[path]
      if (
        isObject(value) &&
        '$each' in value &&
        Array.isArray(value['$each'])
      ) {
        arr.push(...value['$each'])
      } else {
        arr.push(value)
      }
    }
  }
}

function $pull(target: object, operations: Record<string, any>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    const arr = result?.parent[result.key]
    if (result && Array.isArray(arr)) {
      const condition = operations[path]
      result.parent[result.key] = arr.filter(
        (item: any) => !isEqual(item, condition)
      )
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
      for (const item of itemsToAdd) {
        if (!arr.some((existing: any) => isEqual(existing, item))) {
          arr.push(item)
        }
      }
    }
  }
}

function $rename(target: object, operations: Record<string, string>): void {
  for (const oldPath in operations) {
    const newPath = operations[oldPath]
    if (!newPath) continue
    const oldResult = resolvePath(target, oldPath)
    if (oldResult && oldResult.key in oldResult.parent) {
      const value = oldResult.parent[oldResult.key]
      delete oldResult.parent[oldResult.key]
      setPath(target, newPath, value)
    }
  }
}

function $min(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (result && typeof result.parent[result.key] === 'number') {
      const value = operations[path]
      if (value !== undefined && value < result.parent[result.key]) {
        result.parent[result.key] = value
      }
    }
  }
}

function $max(target: object, operations: Record<string, number>): void {
  for (const path in operations) {
    const result = resolvePath(target, path)
    if (result && typeof result.parent[result.key] === 'number') {
      const value = operations[path]
      if (value !== undefined && value > result.parent[result.key]) {
        result.parent[result.key] = value
      }
    }
  }
}

const operators: Record<string, (target: object, operations: any) => void> = {
  $set,
  $inc,
  $push,
  $pull,
  $addToSet,
  $rename,
  $min,
  $max,
}

// --- Public API ---

export type ArrayModifiers<T> = {
  $each: T[]
}

export type UpdateOperations<T> = Partial<{
  $set: Partial<T>
  $inc: { [P in keyof T]?: T[P] extends number ? number : never }
  $push: {
    [P in keyof T]?: T[P] extends (infer E)[] ? E | ArrayModifiers<E> : never
  }
  $pull: { [P in keyof T]?: T[P] extends (infer E)[] ? Partial<E> : never }
  $addToSet: {
    [P in keyof T]?: T[P] extends (infer E)[] ? E | ArrayModifiers<E> : never
  }
  $rename: { [P in keyof T]?: string }
  $min: { [P in keyof T]?: T[P] extends number ? number : never }
  $max: { [P in keyof T]?: T[P] extends number ? number : never }
}>

/**
 * Applies MongoDB-like update operators to a state object.
 * All operations are batched for performance.
 */
export function update<T extends object>(
  target: T,
  operations: UpdateOperations<T>
): void {
  startBatch()
  try {
    for (const op in operations) {
      // Ensure we are only dealing with valid operator keys
      if (op in operators) {
        const operator = operators[op as keyof typeof operators]
        const opArgs = (operations as any)[op]
        // The check above ensures operator is not undefined
        operator?.(target, opArgs)
      }
    }
  } finally {
    endBatch()
  }
}
