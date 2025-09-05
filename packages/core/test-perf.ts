import { createStore, effect } from './src/index'
import { createStore as createSolidStore } from 'solid-js/store'
import { createEffect as createSolidEffect, createRoot } from 'solid-js'

console.log('Performance Test Results\n')
console.log('='.repeat(50))

// Test 1: Reactive property reads
console.log('\n📖 Test 1: Reactive Property Reads (10,000 iterations)')
console.log('-'.repeat(50))

// @storable/core
const [store] = createStore({
  user: { name: 'John', age: 30, email: 'john@example.com' },
})

let storableReadCount = 0
const start1 = performance.now()
effect(() => {
  for (let i = 0; i < 10000; i++) {
    const _ = store.user.name
    storableReadCount++
  }
})
const end1 = performance.now()
const storableReadTime = end1 - start1

// Solid.js
createRoot(() => {
  const [solidStore] = createSolidStore({
    user: { name: 'John', age: 30, email: 'john@example.com' },
  })

  let solidReadCount = 0
  const start2 = performance.now()
  createSolidEffect(() => {
    for (let i = 0; i < 10000; i++) {
      const _ = solidStore.user.name
      solidReadCount++
    }
  })
  const end2 = performance.now()
  const solidReadTime = end2 - start2

  console.log(`@storable/core: ${storableReadTime.toFixed(2)}ms`)
  console.log(`solid-js/store: ${solidReadTime.toFixed(2)}ms`)
  const ratio = storableReadTime / solidReadTime
  if (ratio > 1) {
    console.log(`❌ @storable/core is ${ratio.toFixed(1)}x slower`)
  } else {
    console.log(`✅ @storable/core is ${(1 / ratio).toFixed(1)}x faster`)
  }
})

// Test 2: Array push operations
console.log('\n📝 Test 2: Array Push Operations (1,000 items)')
console.log('-'.repeat(50))

const [store2] = createStore({ items: [] as number[] })
let pushEffectCount = 0

effect(() => {
  const _ = store2.items.length
  pushEffectCount++
})

const start3 = performance.now()
for (let i = 0; i < 1000; i++) {
  store2.items.push(i)
}
const end3 = performance.now()
const storablePushTime = end3 - start3

// Solid.js array test
createRoot(() => {
  const [solidStore2] = createSolidStore({ items: [] as number[] })
  let solidPushEffectCount = 0

  createSolidEffect(() => {
    const _ = solidStore2.items.length
    solidPushEffectCount++
  })

  const start4 = performance.now()
  for (let i = 0; i < 1000; i++) {
    solidStore2.items.push(i)
  }
  const end4 = performance.now()
  const solidPushTime = end4 - start4

  console.log(
    `@storable/core: ${storablePushTime.toFixed(
      2
    )}ms (${pushEffectCount} effects)`
  )
  console.log(
    `solid-js/store: ${solidPushTime.toFixed(
      2
    )}ms (${solidPushEffectCount} effects)`
  )
  const ratio2 = storablePushTime / solidPushTime
  if (ratio2 > 1) {
    console.log(`❌ @storable/core is ${ratio2.toFixed(1)}x slower`)
  } else {
    console.log(`✅ @storable/core is ${(1 / ratio2).toFixed(1)}x faster`)
  }
})

// Test 3: Property updates
console.log('\n🔄 Test 3: Property Updates (1,000 updates)')
console.log('-'.repeat(50))

const [store3, setStore3] = createStore({ count: 0 })
let updateEffectCount = 0

effect(() => {
  const _ = store3.count
  updateEffectCount++
})

const start5 = performance.now()
for (let i = 0; i < 1000; i++) {
  setStore3('count', i)
}
const end5 = performance.now()
const storableUpdateTime = end5 - start5

// Solid.js update test
createRoot(() => {
  const [solidStore3, setSolidStore3] = createSolidStore({ count: 0 })
  let solidUpdateEffectCount = 0

  createSolidEffect(() => {
    const _ = solidStore3.count
    solidUpdateEffectCount++
  })

  const start6 = performance.now()
  for (let i = 0; i < 1000; i++) {
    setSolidStore3('count', i)
  }
  const end6 = performance.now()
  const solidUpdateTime = end6 - start6

  console.log(
    `@storable/core: ${storableUpdateTime.toFixed(
      2
    )}ms (${updateEffectCount} effects)`
  )
  console.log(
    `solid-js/store: ${solidUpdateTime.toFixed(
      2
    )}ms (${solidUpdateEffectCount} effects)`
  )
  const ratio3 = storableUpdateTime / solidUpdateTime
  if (ratio3 > 1) {
    console.log(`❌ @storable/core is ${ratio3.toFixed(1)}x slower`)
  } else {
    console.log(`✅ @storable/core is ${(1 / ratio3).toFixed(1)}x faster`)
  }
})

// Test 4: Object key iteration
console.log('\n🔑 Test 4: Object Key Iteration (100 objects)')
console.log('-'.repeat(50))

const obj4: any = {}
for (let i = 0; i < 100; i++) {
  obj4[`key${i}`] = i
}

const [store4] = createStore(obj4)
let keyEffectCount = 0

const start7 = performance.now()
effect(() => {
  const keys = Object.keys(store4)
  keyEffectCount++
})
const end7 = performance.now()
const storableKeysTime = end7 - start7

// Solid.js keys test
createRoot(() => {
  const [solidStore4] = createSolidStore(obj4)
  let solidKeyEffectCount = 0

  const start8 = performance.now()
  createSolidEffect(() => {
    const keys = Object.keys(solidStore4)
    solidKeyEffectCount++
  })
  const end8 = performance.now()
  const solidKeysTime = end8 - start8

  console.log(`@storable/core: ${storableKeysTime.toFixed(2)}ms`)
  console.log(`solid-js/store: ${solidKeysTime.toFixed(2)}ms`)
  const ratio4 = storableKeysTime / solidKeysTime
  if (ratio4 > 1) {
    console.log(`❌ @storable/core is ${ratio4.toFixed(1)}x slower`)
  } else {
    console.log(`✅ @storable/core is ${(1 / ratio4).toFixed(1)}x faster`)
  }
})

// Test 5: Nested property access
console.log('\n🔍 Test 5: Deep Nested Property Access')
console.log('-'.repeat(50))

const nested = {
  level1: {
    level2: {
      level3: {
        level4: {
          value: 'deep',
        },
      },
    },
  },
}

const [store5] = createStore(nested)
let nestedEffectCount = 0

const start9 = performance.now()
effect(() => {
  for (let i = 0; i < 1000; i++) {
    const _ = store5.level1.level2.level3.level4.value
  }
  nestedEffectCount++
})
const end9 = performance.now()
const storableNestedTime = end9 - start9

// Solid.js nested test
createRoot(() => {
  const [solidStore5] = createSolidStore(nested)
  let solidNestedEffectCount = 0

  const start10 = performance.now()
  createSolidEffect(() => {
    for (let i = 0; i < 1000; i++) {
      const _ = solidStore5.level1.level2.level3.level4.value
    }
    solidNestedEffectCount++
  })
  const end10 = performance.now()
  const solidNestedTime = end10 - start10

  console.log(`@storable/core: ${storableNestedTime.toFixed(2)}ms`)
  console.log(`solid-js/store: ${solidNestedTime.toFixed(2)}ms`)
  const ratio5 = storableNestedTime / solidNestedTime
  if (ratio5 > 1) {
    console.log(`❌ @storable/core is ${ratio5.toFixed(1)}x slower`)
  } else {
    console.log(`✅ @storable/core is ${(1 / ratio5).toFixed(1)}x faster`)
  }

  // Summary
  console.log('\n' + '='.repeat(50))
  console.log('📊 SUMMARY')
  console.log('='.repeat(50))

  const avgRatio = (ratio + ratio2 + ratio3 + ratio4 + ratio5) / 5
  console.log(`\nAverage performance ratio: ${avgRatio.toFixed(2)}x`)

  if (avgRatio > 10) {
    console.log('⚠️  Significant performance gap detected')
  } else if (avgRatio > 2) {
    console.log('⚡ Performance needs improvement')
  } else if (avgRatio > 1.2) {
    console.log('🔧 Minor optimization needed')
  } else if (avgRatio > 0.8) {
    console.log('✅ Performance is comparable to Solid.js!')
  } else {
    console.log('🚀 Performance exceeds Solid.js!')
  }
})
