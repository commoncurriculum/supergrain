import { createStore, effect } from './src/index'

console.log('Performance Bottleneck Analysis\n')
console.log('='.repeat(60))

// Test 1: Baseline - Non-reactive access
console.log('\n1. Non-reactive property access (baseline)')
console.log('-'.repeat(60))

const [store1] = createStore({
  user: { name: 'John', age: 30, email: 'john@example.com' },
})

// Warm up the proxy
const _ = store1.user.name

const iterations = 100000
let start = performance.now()
for (let i = 0; i < iterations; i++) {
  const value = store1.user.name
}
let end = performance.now()
const nonReactiveTime = end - start
console.log(
  `Non-reactive access: ${nonReactiveTime.toFixed(2)}ms for ${iterations} reads`
)
console.log(`Per read: ${((nonReactiveTime / iterations) * 1000).toFixed(3)}µs`)

// Test 2: Reactive access (single effect)
console.log('\n2. Reactive property access (in effect)')
console.log('-'.repeat(60))

const [store2] = createStore({
  user: { name: 'John', age: 30, email: 'john@example.com' },
})

let reactiveReadCount = 0
start = performance.now()
effect(() => {
  for (let i = 0; i < iterations; i++) {
    const value = store2.user.name
    reactiveReadCount++
  }
})
end = performance.now()
const reactiveTime = end - start
console.log(
  `Reactive access: ${reactiveTime.toFixed(2)}ms for ${reactiveReadCount} reads`
)
console.log(`Per read: ${((reactiveTime / iterations) * 1000).toFixed(3)}µs`)
console.log(
  `Reactive overhead: ${(reactiveTime / nonReactiveTime).toFixed(1)}x slower`
)

// Test 3: Signal creation overhead
console.log('\n3. Signal creation overhead')
console.log('-'.repeat(60))

const obj3: any = {}
for (let i = 0; i < 1000; i++) {
  obj3[`prop${i}`] = i
}
const [store3] = createStore(obj3)

// First access creates signals
start = performance.now()
effect(() => {
  for (let i = 0; i < 1000; i++) {
    const value = store3[`prop${i}`]
  }
})
end = performance.now()
const firstAccessTime = end - start
console.log(
  `First reactive access (signal creation): ${firstAccessTime.toFixed(2)}ms`
)

// Second access uses existing signals
start = performance.now()
effect(() => {
  for (let i = 0; i < 1000; i++) {
    const value = store3[`prop${i}`]
  }
})
end = performance.now()
const secondAccessTime = end - start
console.log(
  `Second reactive access (existing signals): ${secondAccessTime.toFixed(2)}ms`
)
console.log(
  `Signal creation overhead: ${(firstAccessTime / secondAccessTime).toFixed(
    1
  )}x`
)

// Test 4: Deep nesting overhead
console.log('\n4. Deep nesting performance')
console.log('-'.repeat(60))

const createDeepObject = (depth: number): any => {
  if (depth === 0) return { value: 'deep' }
  return { next: createDeepObject(depth - 1) }
}

const depths = [1, 5, 10, 20]
for (const depth of depths) {
  const obj = createDeepObject(depth)
  const [store] = createStore(obj)

  // Build access path
  let accessor = 'store'
  for (let i = 0; i < depth; i++) {
    accessor += '.next'
  }
  accessor += '.value'

  // Measure access time
  start = performance.now()
  effect(() => {
    let current: any = store
    for (let j = 0; j < 1000; j++) {
      for (let i = 0; i < depth; i++) {
        current = current.next
      }
      const value = current.value
      current = store
    }
  })
  end = performance.now()
  console.log(`Depth ${depth}: ${end - start}ms for 1000 accesses`)
}

// Test 5: Array method performance
console.log('\n5. Array method performance')
console.log('-'.repeat(60))

const [store5] = createStore({ items: [] as number[] })

let effectRuns = 0
effect(() => {
  const _ = store5.items.length
  effectRuns++
})

// Test push
effectRuns = 0
start = performance.now()
for (let i = 0; i < 100; i++) {
  store5.items.push(i)
}
end = performance.now()
console.log(
  `Push 100 items: ${(end - start).toFixed(2)}ms (${effectRuns} effect runs)`
)

// Test splice
const [store6] = createStore({
  items: Array.from({ length: 100 }, (_, i) => i),
})
effectRuns = 0
effect(() => {
  const _ = store6.items.length
  effectRuns++
})

start = performance.now()
for (let i = 0; i < 50; i++) {
  store6.items.splice(0, 1)
}
end = performance.now()
console.log(
  `Splice 50 items: ${(end - start).toFixed(2)}ms (${effectRuns} effect runs)`
)

// Test 6: Proxy creation vs reuse
console.log('\n6. Proxy creation vs reuse')
console.log('-'.repeat(60))

const [store7] = createStore({
  nested: { deep: { value: 1 } },
})

// First access - creates proxies
start = performance.now()
for (let i = 0; i < 10000; i++) {
  const proxy1 = store7.nested
  const proxy2 = proxy1.deep
  const value = proxy2.value
}
end = performance.now()
const proxyCreationTime = end - start
console.log(`Proxy access (10k iterations): ${proxyCreationTime.toFixed(2)}ms`)

// Check if proxies are cached
const proxy1 = store7.nested
const proxy2 = store7.nested
console.log(`Proxy caching works: ${proxy1 === proxy2}`)

// Test 7: Memory allocation pattern
console.log('\n7. Memory patterns')
console.log('-'.repeat(60))

const used = process.memoryUsage()
console.log('Initial memory:')
console.log(`- RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`)
console.log(`- Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`)

// Create many stores
const stores = []
for (let i = 0; i < 1000; i++) {
  const [store] = createStore({
    id: i,
    data: { value: i, nested: { deep: i } },
  })
  stores.push(store)
}

const usedAfter = process.memoryUsage()
console.log('\nAfter creating 1000 stores:')
console.log(
  `- RSS: ${(usedAfter.rss / 1024 / 1024).toFixed(2)} MB (+${(
    (usedAfter.rss - used.rss) /
    1024 /
    1024
  ).toFixed(2)} MB)`
)
console.log(
  `- Heap Used: ${(usedAfter.heapUsed / 1024 / 1024).toFixed(2)} MB (+${(
    (usedAfter.heapUsed - used.heapUsed) /
    1024 /
    1024
  ).toFixed(2)} MB)`
)

// Summary
console.log('\n' + '='.repeat(60))
console.log('PERFORMANCE SUMMARY')
console.log('='.repeat(60))
console.log(
  `\n✅ Non-reactive read: ${((nonReactiveTime / iterations) * 1000).toFixed(
    3
  )}µs per read`
)
console.log(
  `⚠️  Reactive read: ${((reactiveTime / iterations) * 1000).toFixed(
    3
  )}µs per read`
)
console.log(
  `📊 Reactive overhead: ${(reactiveTime / nonReactiveTime).toFixed(1)}x`
)
console.log(
  `🔄 Signal creation overhead: ${(firstAccessTime / secondAccessTime).toFixed(
    1
  )}x`
)
console.log(
  `💾 Memory per store: ~${(
    (usedAfter.heapUsed - used.heapUsed) /
    1000 /
    1024
  ).toFixed(2)} KB`
)

if (reactiveTime / nonReactiveTime > 100) {
  console.log('\n🚨 Critical performance issue detected!')
  console.log('   Reactive access is more than 100x slower than non-reactive')
} else if (reactiveTime / nonReactiveTime > 10) {
  console.log('\n⚠️  Significant performance gap')
  console.log('   Reactive access is more than 10x slower than non-reactive')
} else {
  console.log('\n✅ Performance is acceptable')
  console.log('   Reactive overhead is within reasonable bounds')
}
