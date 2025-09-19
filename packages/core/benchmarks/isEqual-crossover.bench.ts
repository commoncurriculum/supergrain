import { bench, describe } from 'vitest'

/**
 * Fine-grained benchmark to find the exact crossover point between
 * array.includes() and Set.has() performance in the 30-50 key range.
 */

// Test implementation using array.includes()
function isEqualWithArray(a: unknown, b: unknown): boolean {
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
    if (!keysB.includes(key) || valA !== valB) {
      return false
    }
  }

  return true
}

// Test implementation using Set
function isEqualWithSet(a: unknown, b: unknown): boolean {
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

  const keysBSet = new Set(keysB)

  for (const key of keysA) {
    const valA = (a as Record<string, unknown>)[key]
    const valB = (b as Record<string, unknown>)[key]
    if (!keysBSet.has(key) || valA !== valB) {
      return false
    }
  }

  return true
}

// Create test objects with different numbers of keys
function createTestObject(numKeys: number) {
  const obj: Record<string, number> = {}
  for (let i = 0; i < numKeys; i++) {
    obj[`key${i}`] = i
  }
  return obj
}

// Fine-grained test configurations around the crossover point
const testSizes = [25, 30, 35, 40, 45, 50, 55, 60]

describe('isEqual: Fine-grained crossover analysis', () => {
  for (const size of testSizes) {
    const objA = createTestObject(size)
    const objB = createTestObject(size)
    
    describe(`${size} keys`, () => {
      bench(`array.includes() - ${size} keys`, () => {
        for (let i = 0; i < 1000; i++) {
          isEqualWithArray(objA, objB)
        }
      })

      bench(`Set.has() - ${size} keys`, () => {
        for (let i = 0; i < 1000; i++) {
          isEqualWithSet(objA, objB)
        }
      })
    })
  }
})