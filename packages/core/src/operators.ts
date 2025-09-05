/**
 * MongoDB-style update operators for Storable reactive objects
 * Provides a clean, functional API for complex updates with automatic batching
 */

import { startBatch, endBatch } from 'alien-signals'

// Core types for update operations
export interface UpdateOperations {
  $set?: Record<string, any>
  $unset?: Record<string, true | 1>
  $inc?: Record<string, number>
  $mul?: Record<string, number>
  $push?: Record<string, any>
  $pull?: Record<string, any>
  $pop?: Record<string, 1 | -1>
  $addToSet?: Record<string, any>
  $rename?: Record<string, string>
  $min?: Record<string, any>
  $max?: Record<string, any>
}

// Modifiers for array operations
export interface ArrayModifiers {
  $each?: any[]
  $position?: number
  $slice?: number
  $sort?: 1 | -1 | Record<string, 1 | -1>
}

/**
 * Path resolution result containing parent object, final key, and current value
 */
interface PathResolution {
  parent: any
  key: string
  value: any
}

/**
 * Resolves a dot-notation path to get the parent object and final key
 * Creates intermediate objects as needed
 *
 * @example
 * resolvePath(obj, 'author.name') // Returns parent: obj.author, key: 'name'
 * resolvePath(obj, 'tags.0') // Returns parent: obj.tags, key: '0'
 */
function resolvePath(obj: any, path: string): PathResolution {
  const parts = path.split('.')
  let current = obj

  // Navigate to the parent of the final key
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (!part) continue // Skip empty parts

    // Create intermediate objects if they don't exist
    if (current[part] === undefined || current[part] === null) {
      // Check if next part is a number (array index)
      const nextPart = parts[i + 1]
      const isArrayIndex = nextPart ? /^\d+$/.test(nextPart) : false
      current[part] = isArrayIndex ? [] : {}
    }

    current = current[part]
  }

  const key = parts[parts.length - 1] || ''
  return {
    parent: current,
    key,
    value: current[key],
  }
}

/**
 * Sets a value at a dot-notation path
 * Creates intermediate objects/arrays as needed
 */
function setPath(obj: any, path: string, value: any): void {
  const { parent, key } = resolvePath(obj, path)
  parent[key] = value
}

/**
 * Deletes a property at a dot-notation path
 */
function deletePath(obj: any, path: string): void {
  const { parent, key } = resolvePath(obj, path)

  // Use delete for objects, but handle arrays specially
  if (Array.isArray(parent)) {
    // For arrays, we set to undefined rather than delete to preserve indices
    parent[key as any] = undefined
  } else {
    delete parent[key]
  }
}

/**
 * Deep equality check for comparing values
 * Used for array operations like $pull and $addToSet
 */
function isEqual(a: any, b: any): boolean {
  if (a === b) return true

  if (a === null || b === null) return false
  if (a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false

  if (typeof a !== 'object') return false

  // Arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!isEqual(a[i], b[i])) return false
    }
    return true
  }

  // Objects
  if (!Array.isArray(a) && !Array.isArray(b)) {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
      if (!keysB.includes(key)) return false
      if (!isEqual(a[key], b[key])) return false
    }
    return true
  }

  return false
}

/**
 * Sorts an array in place based on sort specification
 */
function sortArray(
  arr: any[],
  sortSpec: 1 | -1 | Record<string, 1 | -1>
): void {
  if (typeof sortSpec === 'number') {
    // Simple numeric sort
    arr.sort((a, b) => {
      if (sortSpec === 1) return a < b ? -1 : a > b ? 1 : 0
      return a > b ? -1 : a < b ? 1 : 0
    })
  } else {
    // Object sort by properties
    const keys = Object.keys(sortSpec)
    arr.sort((a, b) => {
      for (const key of keys) {
        const direction = sortSpec[key]
        const aVal = a?.[key]
        const bVal = b?.[key]

        if (aVal < bVal) return direction === 1 ? -1 : 1
        if (aVal > bVal) return direction === 1 ? 1 : -1
      }
      return 0
    })
  }
}

// Operator implementations
const operators: Record<string, (target: any, value: any) => void> = {
  /**
   * $set - Sets field values
   * @example { $set: { name: 'John', 'address.city': 'NYC' } }
   */
  $set(target: any, updates: Record<string, any>) {
    for (const [path, value] of Object.entries(updates)) {
      setPath(target, path, value)
    }
  },

  /**
   * $unset - Removes fields
   * @example { $unset: { deprecated: true, 'meta.oldField': 1 } }
   */
  $unset(target: any, paths: Record<string, true | 1>) {
    for (const path of Object.keys(paths)) {
      deletePath(target, path)
    }
  },

  /**
   * $inc - Increments numeric fields
   * @example { $inc: { count: 1, 'stats.views': 10 } }
   */
  $inc(target: any, increments: Record<string, number>) {
    for (const [path, amount] of Object.entries(increments)) {
      const { parent, key, value } = resolvePath(target, path)
      const currentValue = typeof value === 'number' ? value : 0
      parent[key] = currentValue + amount
    }
  },

  /**
   * $mul - Multiplies numeric fields
   * @example { $mul: { price: 0.9, 'discount.percentage': 1.1 } }
   */
  $mul(target: any, multipliers: Record<string, number>) {
    for (const [path, factor] of Object.entries(multipliers)) {
      const { parent, key, value } = resolvePath(target, path)
      const currentValue = typeof value === 'number' ? value : 0
      parent[key] = currentValue * factor
    }
  },

  /**
   * $push - Adds elements to arrays
   * Supports $each, $position, $slice, and $sort modifiers
   * @example { $push: { tags: 'new' } }
   * @example { $push: { tags: { $each: ['a', 'b'], $position: 1 } } }
   */
  $push(target: any, pushes: Record<string, any>) {
    for (const [path, value] of Object.entries(pushes)) {
      const { parent, key } = resolvePath(target, path)

      // Ensure the target is an array
      if (!Array.isArray(parent[key])) {
        parent[key] = []
      }

      const arr = parent[key]

      // Check for modifiers
      if (value && typeof value === 'object' && '$each' in value) {
        const modifiers = value as ArrayModifiers
        const items = modifiers.$each || []
        const position = modifiers.$position

        // Insert at position or at end
        if (position !== undefined && position >= 0) {
          arr.splice(position, 0, ...items)
        } else {
          arr.push(...items)
        }

        // Apply $sort if specified
        if (modifiers.$sort !== undefined) {
          sortArray(arr, modifiers.$sort)
        }

        // Apply $slice if specified (limit array size)
        if (modifiers.$slice !== undefined) {
          if (modifiers.$slice < 0) {
            // Keep last N elements
            arr.splice(0, arr.length + modifiers.$slice)
          } else if (modifiers.$slice === 0) {
            // Empty the array
            arr.length = 0
          } else {
            // Keep first N elements
            arr.length = Math.min(arr.length, modifiers.$slice)
          }
        }
      } else {
        // Simple push
        arr.push(value)
      }
    }
  },

  /**
   * $pull - Removes matching elements from arrays
   * @example { $pull: { tags: 'deprecated' } }
   * @example { $pull: { scores: { $gt: 5 } } } // With conditions (basic implementation)
   */
  $pull(target: any, pulls: Record<string, any>) {
    for (const [path, value] of Object.entries(pulls)) {
      const { parent, key } = resolvePath(target, path)

      if (Array.isArray(parent[key])) {
        // Filter out matching values
        parent[key] = parent[key].filter(item => !isEqual(item, value))
      }
    }
  },

  /**
   * $pop - Removes first or last element from arrays
   * @example { $pop: { tags: 1 } } // Remove last
   * @example { $pop: { tags: -1 } } // Remove first
   */
  $pop(target: any, pops: Record<string, 1 | -1>) {
    for (const [path, direction] of Object.entries(pops)) {
      const { parent, key } = resolvePath(target, path)

      if (Array.isArray(parent[key]) && parent[key].length > 0) {
        if (direction === 1) {
          parent[key].pop()
        } else {
          parent[key].shift()
        }
      }
    }
  },

  /**
   * $addToSet - Adds unique elements to arrays
   * Supports $each modifier
   * @example { $addToSet: { tags: 'unique' } }
   * @example { $addToSet: { tags: { $each: ['a', 'b'] } } }
   */
  $addToSet(target: any, additions: Record<string, any>) {
    for (const [path, value] of Object.entries(additions)) {
      const { parent, key } = resolvePath(target, path)

      // Ensure the target is an array
      if (!Array.isArray(parent[key])) {
        parent[key] = []
      }

      const arr = parent[key]

      // Check for $each modifier
      if (value && typeof value === 'object' && '$each' in value) {
        const items = value.$each || []
        for (const item of items) {
          if (!arr.some((existing: any) => isEqual(existing, item))) {
            arr.push(item)
          }
        }
      } else {
        // Single value
        if (!arr.some((existing: any) => isEqual(existing, value))) {
          arr.push(value)
        }
      }
    }
  },

  /**
   * $rename - Renames fields
   * @example { $rename: { oldName: 'newName', 'old.nested': 'new.nested' } }
   */
  $rename(target: any, renames: Record<string, string>) {
    for (const [oldPath, newPath] of Object.entries(renames)) {
      const {
        parent: oldParent,
        key: oldKey,
        value,
      } = resolvePath(target, oldPath)

      // Only rename if the old field exists
      if (value !== undefined) {
        // Set the new path
        setPath(target, newPath, value)

        // Delete the old path
        if (Array.isArray(oldParent)) {
          oldParent[oldKey as any] = undefined
        } else {
          delete oldParent[oldKey]
        }
      }
    }
  },

  /**
   * $min - Updates field only if new value is less than current
   * @example { $min: { lowestScore: 50 } }
   */
  $min(target: any, minimums: Record<string, any>) {
    for (const [path, value] of Object.entries(minimums)) {
      const { parent, key, value: currentValue } = resolvePath(target, path)

      // Update only if new value is less than current (or current is undefined)
      if (currentValue === undefined || value < currentValue) {
        parent[key] = value
      }
    }
  },

  /**
   * $max - Updates field only if new value is greater than current
   * @example { $max: { highestScore: 100 } }
   */
  $max(target: any, maximums: Record<string, any>) {
    for (const [path, value] of Object.entries(maximums)) {
      const { parent, key, value: currentValue } = resolvePath(target, path)

      // Update only if new value is greater than current (or current is undefined)
      if (currentValue === undefined || value > currentValue) {
        parent[key] = value
      }
    }
  },
}

/**
 * Main update function - applies MongoDB-style update operations to a reactive object
 * All operations are automatically batched for performance
 *
 * @param target - The reactive object to update (from createStore)
 * @param operations - Object containing update operators
 *
 * @example
 * import { update } from '@storable/core'
 *
 * const post = store.get('posts').get('1')
 * update(post, {
 *   $set: { title: 'New Title', 'meta.updated': Date.now() },
 *   $inc: { viewCount: 1 },
 *   $push: { tags: { $each: ['featured', 'trending'] } },
 *   $pull: { categories: 'deprecated' }
 * })
 */
export function update<T extends object>(
  target: T,
  operations: UpdateOperations
): void {
  startBatch()
  try {
    // Apply each operator in order
    // MongoDB applies operators in a specific order, we follow similar logic
    const operatorOrder = [
      '$inc', // Numeric operations first
      '$mul',
      '$min',
      '$max',
      '$set', // Field updates
      '$unset',
      '$rename',
      '$push', // Array operations
      '$pull',
      '$pop',
      '$addToSet',
    ]

    for (const op of operatorOrder) {
      if (op in operations && operators[op]) {
        operators[op](target, (operations as any)[op])
      }
    }

    // Check for unknown operators
    for (const op in operations) {
      if (!operators[op]) {
        throw new Error(`Unknown update operator: ${op}`)
      }
    }
  } finally {
    endBatch()
  }
}

// Export utility functions for advanced use cases
export { resolvePath, setPath, deletePath, isEqual }
