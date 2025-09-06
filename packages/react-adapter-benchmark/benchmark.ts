import { createStore, effect, signal, computed, unwrap } from '../core/src'
import { performance } from 'perf_hooks'

// Types for tracking metrics
interface BenchmarkResult {
  name: string
  iterations: number
  totalTime: number
  avgTime: number
  opsPerSecond: number
  memoryUsed: number
}

// Helper to measure memory usage
function getMemoryUsage(): number {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed
  }
  return 0
}

// Helper to run a benchmark
async function runBenchmark(
  name: string,
  fn: () => void,
  iterations: number = 100000
): Promise<BenchmarkResult> {
  // Warm up
  for (let i = 0; i < 100; i++) {
    fn()
  }

  // Force garbage collection if available
  if (global.gc) {
    global.gc()
  }

  const startMemory = getMemoryUsage()
  const startTime = performance.now()

  for (let i = 0; i < iterations; i++) {
    fn()
  }

  const endTime = performance.now()
  const endMemory = getMemoryUsage()

  const totalTime = endTime - startTime
  const avgTime = totalTime / iterations
  const opsPerSecond = (iterations / totalTime) * 1000

  return {
    name,
    iterations,
    totalTime,
    avgTime,
    opsPerSecond,
    memoryUsed: endMemory - startMemory,
  }
}

// Benchmark 1: Simple property access
async function benchmarkSimpleAccess() {
  console.log('\n=== Benchmark 1: Simple Property Access ===\n')

  // Setup: Proxy-based store
  const [proxyState] = createStore({
    count: 0,
    value: 42,
    text: 'hello',
  })

  // Setup: Direct signals
  const countSignal = signal(0)
  const valueSignal = signal(42)
  const textSignal = signal('hello')

  // Test proxy access
  const proxyResult = await runBenchmark('Proxy Access', () => {
    const a = proxyState.count
    const b = proxyState.value
    const c = proxyState.text
  })

  // Test direct signal access
  const signalResult = await runBenchmark('Direct Signal Access', () => {
    const a = countSignal()
    const b = valueSignal()
    const c = textSignal()
  })

  return { proxyResult, signalResult }
}

// Benchmark 2: Nested object access
async function benchmarkNestedAccess() {
  console.log('\n=== Benchmark 2: Nested Object Access ===\n')

  // Setup: Proxy-based store
  const [proxyState] = createStore({
    user: {
      profile: {
        name: 'Alice',
        age: 30,
        address: {
          city: 'New York',
          zip: '10001',
        },
      },
    },
  })

  // Setup: Direct signals
  const userSignal = signal({
    profile: {
      name: 'Alice',
      age: 30,
      address: {
        city: 'New York',
        zip: '10001',
      },
    },
  })

  // Test proxy access
  const proxyResult = await runBenchmark('Proxy Nested Access', () => {
    const name = proxyState.user.profile.name
    const city = proxyState.user.profile.address.city
  })

  // Test direct signal access
  const signalResult = await runBenchmark('Signal Nested Access', () => {
    const user = userSignal()
    const name = user.profile.name
    const city = user.profile.address.city
  })

  return { proxyResult, signalResult }
}

// Benchmark 3: Array iteration
async function benchmarkArrayIteration() {
  console.log('\n=== Benchmark 3: Array Iteration ===\n')

  const items = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    value: i * 2,
    name: `Item ${i}`,
  }))

  // Setup: Proxy-based store
  const [proxyState] = createStore({ items })

  // Setup: Direct signal
  const itemsSignal = signal(items)

  // Test proxy iteration
  const proxyResult = await runBenchmark(
    'Proxy Array Iteration',
    () => {
      let sum = 0
      for (const item of proxyState.items) {
        sum += item.value
      }
    },
    10000
  ) // Fewer iterations for array operations

  // Test signal iteration
  const signalResult = await runBenchmark(
    'Signal Array Iteration',
    () => {
      let sum = 0
      const items = itemsSignal()
      for (const item of items) {
        sum += item.value
      }
    },
    10000
  )

  return { proxyResult, signalResult }
}

// Benchmark 4: Reactive updates (write performance)
async function benchmarkReactiveUpdates() {
  console.log('\n=== Benchmark 4: Reactive Updates ===\n')

  // Setup: Proxy-based store
  const [proxyState, updateProxy] = createStore({ count: 0 })
  let proxyEffectCount = 0
  effect(() => {
    const _ = proxyState.count
    proxyEffectCount++
  })

  // Setup: Direct signal
  const countSignal = signal(0)
  let signalEffectCount = 0
  effect(() => {
    const _ = countSignal()
    signalEffectCount++
  })

  // Test proxy updates
  const proxyResult = await runBenchmark(
    'Proxy Updates',
    () => {
      updateProxy({ $inc: { count: 1 } })
    },
    1000
  ) // Fewer iterations for update operations

  // Test signal updates
  const signalResult = await runBenchmark(
    'Signal Updates',
    () => {
      countSignal(countSignal() + 1)
    },
    1000
  )

  console.log(`  Proxy effects triggered: ${proxyEffectCount}`)
  console.log(`  Signal effects triggered: ${signalEffectCount}`)

  return { proxyResult, signalResult }
}

// Benchmark 5: Complex computed values
async function benchmarkComputedValues() {
  console.log('\n=== Benchmark 5: Complex Computed Values ===\n')

  // Setup: Proxy-based store with computed
  const [proxyState] = createStore({
    items: Array.from({ length: 50 }, (_, i) => ({ value: i })),
  })

  const proxyComputed = computed(() => {
    return proxyState.items.reduce((sum, item) => sum + item.value, 0)
  })

  // Setup: Direct signals with computed
  const itemsSignal = signal(
    Array.from({ length: 50 }, (_, i) => ({ value: i }))
  )

  const signalComputed = computed(() => {
    return itemsSignal().reduce((sum, item) => sum + item.value, 0)
  })

  // Test proxy computed access
  const proxyResult = await runBenchmark('Proxy Computed', () => {
    const _ = proxyComputed()
  })

  // Test signal computed access
  const signalResult = await runBenchmark('Signal Computed', () => {
    const _ = signalComputed()
  })

  return { proxyResult, signalResult }
}

// Benchmark 6: Memory pressure test
async function benchmarkMemoryPressure() {
  console.log('\n=== Benchmark 6: Memory Pressure (Many Components) ===\n')

  // Simulate many components subscribing to different parts
  const componentCount = 1000

  // Setup: Proxy-based approach
  const [proxyState] = createStore({
    users: Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      score: Math.random() * 100,
    })),
  })

  const proxyEffects: Array<() => void> = []
  const proxyStart = performance.now()

  for (let i = 0; i < componentCount; i++) {
    const userIndex = i % 100
    const dispose = effect(() => {
      // Simulate component accessing specific user
      const _ = proxyState.users[userIndex].name
    })
    proxyEffects.push(dispose)
  }

  const proxySetupTime = performance.now() - proxyStart

  // Setup: Direct signals approach
  const usersSignal = signal(
    Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `User ${i}`,
      score: Math.random() * 100,
    }))
  )

  const signalEffects: Array<() => void> = []
  const signalStart = performance.now()

  for (let i = 0; i < componentCount; i++) {
    const userIndex = i % 100
    const dispose = effect(() => {
      // Simulate component accessing specific user
      const users = usersSignal()
      const _ = users[userIndex].name
    })
    signalEffects.push(dispose)
  }

  const signalSetupTime = performance.now() - signalStart

  // Cleanup
  proxyEffects.forEach(dispose => dispose())
  signalEffects.forEach(dispose => dispose())

  return {
    proxySetupTime,
    signalSetupTime,
    componentCount,
  }
}

// Format results
function formatResult(result: BenchmarkResult) {
  console.log(`  ${result.name}:`)
  console.log(`    Total time: ${result.totalTime.toFixed(2)}ms`)
  console.log(`    Avg time: ${(result.avgTime * 1000).toFixed(3)}μs`)
  console.log(`    Ops/second: ${result.opsPerSecond.toFixed(0)}`)
  if (result.memoryUsed > 0) {
    console.log(`    Memory: ${(result.memoryUsed / 1024).toFixed(2)}KB`)
  }
}

// Main benchmark runner
async function runAllBenchmarks() {
  console.log('===================================')
  console.log('  STORABLE PERFORMANCE BENCHMARK')
  console.log('  Proxy-based vs Direct Signals')
  console.log('===================================')

  const results: any = {}

  // Run benchmarks
  const simpleAccess = await benchmarkSimpleAccess()
  formatResult(simpleAccess.proxyResult)
  formatResult(simpleAccess.signalResult)
  results.simpleAccess = {
    speedup:
      simpleAccess.signalResult.opsPerSecond /
      simpleAccess.proxyResult.opsPerSecond,
  }

  const nestedAccess = await benchmarkNestedAccess()
  formatResult(nestedAccess.proxyResult)
  formatResult(nestedAccess.signalResult)
  results.nestedAccess = {
    speedup:
      nestedAccess.signalResult.opsPerSecond /
      nestedAccess.proxyResult.opsPerSecond,
  }

  const arrayIteration = await benchmarkArrayIteration()
  formatResult(arrayIteration.proxyResult)
  formatResult(arrayIteration.signalResult)
  results.arrayIteration = {
    speedup:
      arrayIteration.signalResult.opsPerSecond /
      arrayIteration.proxyResult.opsPerSecond,
  }

  const updates = await benchmarkReactiveUpdates()
  formatResult(updates.proxyResult)
  formatResult(updates.signalResult)
  results.updates = {
    speedup:
      updates.signalResult.opsPerSecond / updates.proxyResult.opsPerSecond,
  }

  const computed = await benchmarkComputedValues()
  formatResult(computed.proxyResult)
  formatResult(computed.signalResult)
  results.computed = {
    speedup:
      computed.signalResult.opsPerSecond / computed.proxyResult.opsPerSecond,
  }

  const memory = await benchmarkMemoryPressure()
  console.log('\n=== Memory Pressure Results ===')
  console.log(`  Components: ${memory.componentCount}`)
  console.log(`  Proxy setup: ${memory.proxySetupTime.toFixed(2)}ms`)
  console.log(`  Signal setup: ${memory.signalSetupTime.toFixed(2)}ms`)
  results.memory = {
    speedup: memory.proxySetupTime / memory.signalSetupTime,
  }

  // Summary
  console.log('\n===================================')
  console.log('           SUMMARY')
  console.log('===================================\n')
  console.log('Signal Performance vs Proxy (higher is better for signals):')
  console.log(`  Simple Access: ${results.simpleAccess.speedup.toFixed(2)}x`)
  console.log(`  Nested Access: ${results.nestedAccess.speedup.toFixed(2)}x`)
  console.log(
    `  Array Iteration: ${results.arrayIteration.speedup.toFixed(2)}x`
  )
  console.log(`  Updates: ${results.updates.speedup.toFixed(2)}x`)
  console.log(`  Computed Values: ${results.computed.speedup.toFixed(2)}x`)
  console.log(`  Memory Setup: ${results.memory.speedup.toFixed(2)}x`)

  const avgSpeedup =
    (results.simpleAccess.speedup +
      results.nestedAccess.speedup +
      results.arrayIteration.speedup +
      results.updates.speedup +
      results.computed.speedup) /
    5

  console.log(`\n  Average Performance Difference: ${avgSpeedup.toFixed(2)}x`)

  if (avgSpeedup > 2) {
    console.log('\n⚠️  Direct signals are significantly faster')
    console.log(
      '   Consider exposing signal API for performance-critical paths'
    )
  } else if (avgSpeedup > 1.3) {
    console.log('\n⚡ Direct signals are moderately faster')
    console.log('   Proxy overhead exists but may be acceptable')
  } else {
    console.log('\n✅ Performance difference is negligible')
    console.log('   Proxy-based API is recommended for simplicity')
  }
}

// Run if executed directly
if (require.main === module) {
  runAllBenchmarks().catch(console.error)
}

export { runAllBenchmarks, runBenchmark }
