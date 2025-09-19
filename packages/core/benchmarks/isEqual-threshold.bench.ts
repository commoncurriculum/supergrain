import { bench, describe } from 'vitest'

/**
 * Benchmark to determine the optimal threshold for using Set vs array.includes()
 * in the isEqual function for object key lookups.
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

// Test configurations - different object sizes
const testSizes = [2, 5, 10, 15, 20, 30, 50, 100]

describe('isEqual: Set vs Array.includes() Performance', () => {
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

  // Additional test: worst case scenario where the last key doesn't match
  describe('Worst case: key not found (last position)', () => {
    for (const size of [5, 10, 15, 20, 30]) {
      const objA = createTestObject(size)
      const objB = { ...createTestObject(size - 1), [`differentKey${size}`]: 999 }

      describe(`${size} keys - key not found`, () => {
        bench(`array.includes() - ${size} keys (not found)`, () => {
          for (let i = 0; i < 1000; i++) {
            isEqualWithArray(objA, objB)
          }
        })

        bench(`Set.has() - ${size} keys (not found)`, () => {
          for (let i = 0; i < 1000; i++) {
            isEqualWithSet(objA, objB)
          }
        })
      })
    }
  })

  // Test the overhead of Set creation
  describe('Set creation overhead', () => {
    for (const size of [5, 10, 15, 20]) {
      const keys = Array.from({ length: size }, (_, i) => `key${i}`)

      bench(`Set creation - ${size} keys`, () => {
        for (let i = 0; i < 10000; i++) {
          const set = new Set(keys)
          void set
        }
      })

      bench(`Array creation - ${size} keys`, () => {
        for (let i = 0; i < 10000; i++) {
          const arr = [...keys]
          void arr
        }
      })
    }
  })
})