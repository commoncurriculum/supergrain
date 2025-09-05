# Storable Proxy Overhead Benchmarks

## Overview
This document outlines a focused benchmarking strategy to measure the proxy overhead in Storable by comparing against raw alien-signals performance.

## Core Question
How much overhead do our proxies add compared to using alien-signals directly?

## What to Measure

### 1. Signal Creation Overhead
```typescript
// Raw alien-signals
const titleSignal = signal('Hello')
titleSignal.value = 'World'

// VS Storable proxy
const post = store.find('posts', '1')
post.title = 'World' // Creates signal internally
```

### 2. Nested Property Access
```typescript
// Raw alien-signals (manual nesting)
const userSignal = signal({
  profileSignal: signal({
    settingsSignal: signal({
      themeSignal: signal('dark')
    })
  })
})

// VS Storable proxy (automatic)
const user = store.find('users', '1')
const theme = user.profile.settings.theme // Auto-creates nested signals
```

### 3. Array Operations
```typescript
// Raw alien-signals
const tagsSignal = signal(['a', 'b'])
tagsSignal.value = [...tagsSignal.value, 'c']

// VS Storable proxy
const post = store.find('posts', '1')
post.tags.push('c') // ArraySignal handling
```

## Benchmark Scenarios

### Scenario 1: Property Access Path
Measure the cost of accessing deeply nested properties for the first time (signal creation) and subsequent times (signal retrieval).

```typescript
// Test depths: 1, 3, 5, 10 levels
// Measure: Time to access leaf property
// Compare: Raw signals vs proxy traversal
```

### Scenario 2: Bulk Updates
Measure the overhead when updating multiple properties in rapid succession.

```typescript
// Update 100 properties on same object
// Compare: Direct signal updates vs proxy setter calls
// Measure: Total time, memory allocated
```

### Scenario 3: Array Mutations
Measure the overhead of our ArraySignal implementation.

```typescript
// Operations: push, splice, pop on 1000-element arrays
// Compare: Immutable array updates vs ArraySignal mutations
// Measure: Time per operation, memory churn
```

## Key Metrics

1. **Time Overhead**: How many microseconds does the proxy layer add?
2. **Memory Overhead**: Extra memory used by proxy objects and caching
3. **GC Pressure**: How many temporary objects are created?

## Implementation

```typescript
interface BenchmarkResult {
  name: string
  rawSignalTime: number // microseconds
  proxyTime: number // microseconds
  overheadRatio: number // proxyTime / rawSignalTime
  memoryOverhead: number // bytes
}

// Example benchmark
function benchmarkPropertyAccess(): BenchmarkResult {
  // Raw signals
  const start1 = performance.now()
  const obj = {
    title: signal('Hello'),
    author: { name: signal('John') }
  }
  obj.title.value = 'World'
  const rawTime = performance.now() - start1

  // Proxy version
  const start2 = performance.now()
  const post = store.find('posts', '1')
  post.title = 'World'
  const proxyTime = performance.now() - start2

  return {
    name: 'property-access',
    rawSignalTime: rawTime * 1000,
    proxyTime: proxyTime * 1000,
    overheadRatio: proxyTime / rawTime,
    memoryOverhead: 0 // measured separately
  }
}
```

## Success Criteria

- Proxy overhead < 2x for simple property access
- Proxy overhead < 3x for nested property access
- Array operation overhead < 2x compared to immutable updates
- Memory overhead < 50% of base object size

## Comparison Libraries

### Primary Comparisons
1. **Raw alien-signals** - Our baseline
2. **Vue 3 reactive()** - Similar proxy-based approach
3. **Solid.js createStore()** - Fine-grained reactive store

### Quick Reference Benchmark
```typescript
// Same operation across all libraries:
// 1. Create object with 10 properties
// 2. Access 5 properties
// 3. Update 3 properties
// 4. Measure total time and memory
```

## Reporting

Results should show:
- Overhead ratio (1.5x means 50% slower than raw signals)
- Absolute time difference in microseconds
- Memory overhead in bytes
- Whether success criteria are met
