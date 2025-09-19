# isEqual Function Threshold Analysis

## Summary

Performance benchmarking was conducted to determine the optimal threshold for switching from `array.includes()` to `Set.has()` in the `isEqual` function for object key lookups.

## Key Findings

**Crossover Point: ~50 keys**

- `array.includes()` is faster for objects with fewer than 50 keys
- `Set.has()` becomes faster for objects with 50+ keys
- The performance difference is significant enough to justify the optimization

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

Set creation has significant overhead compared to array operations:

- Set creation (20 keys): ~170 ops/sec
- Array creation (20 keys): ~5,240 ops/sec
- **Array creation is ~31x faster than Set creation**

This overhead is amortized when the Set is used for multiple lookups, which happens in the `isEqual` function when comparing all keys.

## Implementation Decision

Based on the benchmark results, the threshold was set to **50 keys**:

```typescript
// Use Set for keysB to avoid quadratic time complexity, but only for large objects
// Benchmark testing shows Set becomes faster than array.includes() at around 50 keys
const keysBSet = keysB.length >= 50 ? new Set(keysB) : null
```

## Reasoning

1. **Performance**: `array.includes()` is consistently faster for small to medium objects (< 50 keys)
2. **Memory efficiency**: Arrays have lower memory overhead than Sets for small collections
3. **Real-world usage**: Most objects in typical applications have fewer than 50 properties
4. **Safety margin**: The 50-key threshold provides a conservative approach, ensuring we only use Sets when they provide clear performance benefits

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

## Running the Benchmarks

To reproduce these results, save either benchmark code section to a `.bench.ts` file and run:

```bash
cd packages/core
pnpm bench path/to/benchmark-file.bench.ts
```