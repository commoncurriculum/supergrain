import { describe, it, expect } from 'vitest'
import { createStore } from '../src/store'
import { effect, getCurrentSub, setCurrentSub } from 'alien-signals'

describe('Object Property Isolation', () => {
  it('validates README claim: accessing items[0].name should track only that property, not the whole object', () => {
    /**
     * README claim: "Accessing state.items[0].name WILL re-render when state.items[0].age changes (same object)"
     * 
     * This test validates whether this is true or false.
     */
    const [store, update] = createStore({
      items: [
        { name: 'John', age: 30 }
      ]
    })

    let effectRuns = 0

    // Simulate useTrackedStore pattern
    let effectNode: any = null
    let isFirstRun = true

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        effectRuns++
        return
      }
      effectRuns++
    })

    // Create proxy that isolates property access (like useTrackedStore)
    function createIsolatingProxy(target: any): any {
      return new Proxy(target, {
        get(obj, prop) {
          const prevSub = getCurrentSub()
          setCurrentSub(effectNode)
          try {
            const value = Reflect.get(obj, prop)
            // Wrap nested objects/arrays in proxies too
            if (value && typeof value === 'object') {
              return createIsolatingProxy(value)
            }
            return value
          } finally {
            setCurrentSub(prevSub)
          }
        }
      })
    }

    const proxy = createIsolatingProxy(store)

    // Access only the 'name' property through the proxy
    const item = proxy.items[0]
    const name = item.name  // Only access 'name', NOT 'age'
    
    expect(name).toBe('John')
    expect(effectRuns).toBe(1)  // Initial run

    console.log('\n=== Test: Accessing items[0].name, then updating items[0].age ===')
    console.log(`Initial effectRuns: ${effectRuns}`)

    // Update the 'age' property that we DID NOT access
    update({ $set: { 'items.0.age': 31 } })

    console.log(`After updating age: ${effectRuns}`)

    // Update the 'name' property that we DID access
    update({ $set: { 'items.0.name': 'Jane' } })

    console.log(`After updating name: ${effectRuns}`)

    cleanup()

    // Based on the README, it claims:
    // "Accessing state.items[0].name WILL re-render when state.items[0].age changes"
    // 
    // But based on the fine-grained reactivity system, this should NOT be true
    // because tracking happens at the property level, not the object level.
    
    console.log('\n=== Analysis ===')
    console.log(`README claim: "Accessing state.items[0].name WILL re-render when state.items[0].age changes"`)
    
    // If effectRuns is 2, it means updating 'age' did NOT trigger re-render
    // If effectRuns is 3, it means updating 'age' DID trigger re-render
    
    if (effectRuns === 2) {
      console.log('✗ README claim is INCORRECT')
      console.log('  Updating age did NOT trigger effect')
      console.log('  Only updating name triggered effect')
      console.log('  The system has property-level granularity, not object-level')
    } else if (effectRuns === 3) {
      console.log('✓ README claim is CORRECT')
      console.log('  Updating age DID trigger effect')
      console.log('  The system tracks at object-level, not property-level')
    }

    // This will reveal whether the README statement is accurate
  })

  it('tests the behavior at different access levels', () => {
    /**
     * This test checks at what level the tracking actually happens:
     * 1. Object level (items[0]) - would track all properties
     * 2. Property level (items[0].name) - would track only that property
     */
    const [store, update] = createStore({
      items: [
        { name: 'John', age: 30, city: 'NYC' }
      ]
    })

    let effectRuns = 0
    let effectNode: any = null
    let isFirstRun = true

    const cleanup = effect(() => {
      if (isFirstRun) {
        effectNode = getCurrentSub()
        isFirstRun = false
        effectRuns++
        return
      }
      effectRuns++
    })

    function createIsolatingProxy(target: any): any {
      return new Proxy(target, {
        get(obj, prop) {
          const prevSub = getCurrentSub()
          setCurrentSub(effectNode)
          try {
            const value = Reflect.get(obj, prop)
            // Wrap nested objects/arrays in proxies too
            if (value && typeof value === 'object') {
              return createIsolatingProxy(value)
            }
            return value
          } finally {
            setCurrentSub(prevSub)
          }
        }
      })
    }

    const proxy = createIsolatingProxy(store)

    // Only access name property
    const name = proxy.items[0].name
    expect(name).toBe('John')
    expect(effectRuns).toBe(1)

    console.log('\n=== Testing Property-Level Tracking ===')
    console.log(`Accessed: items[0].name`)
    console.log(`Initial effectRuns: ${effectRuns}`)

    // Test 1: Update age (not accessed)
    update({ $set: { 'items.0.age': 31 } })
    console.log(`After updating items[0].age: ${effectRuns}`)
    const afterAgeUpdate = effectRuns

    // Test 2: Update city (not accessed)
    update({ $set: { 'items.0.city': 'LA' } })
    console.log(`After updating items[0].city: ${effectRuns}`)
    const afterCityUpdate = effectRuns

    // Test 3: Update name (accessed)
    update({ $set: { 'items.0.name': 'Jane' } })
    console.log(`After updating items[0].name: ${effectRuns}`)
    const afterNameUpdate = effectRuns

    cleanup()

    console.log('\n=== Results ===')
    console.log(`Updating unaccessed properties (age, city): ${afterCityUpdate === 1 ? 'NO effect' : 'triggered effect'}`)
    console.log(`Updating accessed property (name): ${afterNameUpdate > afterCityUpdate ? 'triggered effect' : 'NO effect'}`)

    // Validate fine-grained reactivity
    expect(afterAgeUpdate).toBe(1)  // age update should not trigger
    expect(afterCityUpdate).toBe(1) // city update should not trigger  
    expect(afterNameUpdate).toBe(2) // name update should trigger

    console.log('✓ CONFIRMED: Tracking is at PROPERTY level, not object level')
  })
})
