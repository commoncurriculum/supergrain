# isEqual Function: Set vs Array.includes() Threshold Analysis

> **Status**: Current. Determined the 50-key threshold used in production `isEqual`.
> **TL;DR**: `array.includes()` wins below 50 keys, `Set.has()` wins above. Threshold set to 50 in implementation. Set creation is 31x slower than array creation but amortized over multiple lookups.

## Benchmark Results

### Performance by Object Size

| Keys | array.includes() (ops/sec) | Set.has() (ops/sec) | Winner | Performance Difference |
|------|---------------------------|---------------------|---------|----------------------|
| 2    | 16,323                    | 10,103             | Array   | 1.62x faster         |
| 5    | 7,440                     | 3,619              | Array   | 2.06x faster         |
| 10   | 2,715                     | 1,466              | Array   | 1.85x faster         |
| 15   | 1,574                     | 1,016              | Array   | 1.55x faster         |
| 20   | 999                       | 762                | Array   | 1.31x faster         |
| 30   | 434                       | 377                | Array   | 1.15x faster         |
| 40   | 289                       | 270                | Array   | 1.07x faster         |
| 45   | 250                       | 238                | Array   | 1.05x faster         |
| **50** | **219**               | **224**            | **Set** | **1.02x faster**     |
| 55   | 184                       | 201                | Set     | 1.09x faster         |
| 60   | 168                       | 191                | Set     | 1.14x faster         |
| 100  | 102                       | 144                | Set     | 1.41x faster         |

### Set Creation Overhead
- Set creation (20 keys): ~170 ops/sec
- Array creation (20 keys): ~5,240 ops/sec
- Array creation is ~31x faster

## Implementation

```typescript
const keysBSet = keysB.length >= 50 ? new Set(keysB) : null
```

Set creation is ~31x slower than array creation but amortized across multiple lookups in `isEqual`. Most real-world objects have <50 properties, so the array path dominates.

## Benchmark Code

### Comprehensive Threshold Testing

```typescript
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
```

### Fine-grained Crossover Analysis

```typescript
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
```

## Running

Save benchmark code to a `.bench.ts` file and run `pnpm bench path/to/file.bench.ts` from `packages/core`.