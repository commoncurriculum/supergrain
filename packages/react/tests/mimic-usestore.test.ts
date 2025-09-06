import { describe, it, expect } from 'vitest'
import {
  createStore,
  effect,
  getCurrentSub,
  setCurrentSub,
} from '@storable/core'
import { flushMicrotasks } from './test-utils'

describe('Mimic useStore Behavior', () => {
  it('should exactly mimic what useStore does', async () => {
    console.log('\n=== TEST: Mimicking useStore behavior ===\n')

    const [store, update] = createStore({ value: 1 })
    let effectRuns = 0
    let version = 0
    let onChangeNotifyReact: (() => void) | null = null
    let isFirstRun = true

    // Step 1: Save current subscriber (should be undefined)
    const prevSub = getCurrentSub()
    console.log('1. Previous subscriber:', prevSub)

    // Step 2: Temporarily clear current subscriber (like useStore does)
    setCurrentSub(undefined)
    console.log('2. Cleared current subscriber')

    // Step 3: Create effect with callback that doesn't access store
    // This mimics what useStore does
    const cleanup = effect(() => {
      console.log(`3. Effect callback running, isFirstRun: ${isFirstRun}`)

      if (!isFirstRun) {
        version = (version + 1) | 0
        console.log(`   Version incremented to: ${version}`)
        if (onChangeNotifyReact) {
          console.log('   Notifying React!')
          onChangeNotifyReact()
        }
      } else {
        isFirstRun = false
        console.log('   First run complete')
      }

      effectRuns++
    })

    // Get the effect node
    const effectNode = getCurrentSub()
    console.log('4. Effect node after creation:', effectNode)
    console.log('   Effect deps initially:', (effectNode as any)?.deps)

    // Step 4: Set our effect as current subscriber
    setCurrentSub(effectNode)
    console.log('5. Set effect as current subscriber')

    // Step 5: Access the store (simulating component render)
    console.log('6. Accessing store.value...')
    const value1 = store.value
    console.log(`   Got value: ${value1}`)
    console.log('   Effect deps after access:', (effectNode as any)?.deps)

    // Step 6: Restore previous subscriber (simulating finish())
    setCurrentSub(prevSub)
    console.log('7. Restored previous subscriber')
    console.log('   Effect deps after restore:', (effectNode as any)?.deps)

    // Step 7: Set up React notification (simulating subscribe)
    onChangeNotifyReact = () => {
      console.log('   >>> React notified of change!')
    }
    console.log('8. Set up React notification callback')

    // Check initial state
    console.log('\n9. Initial state:')
    console.log(`   effectRuns: ${effectRuns}`)
    console.log(`   version: ${version}`)
    console.log(`   store.value: ${store.value}`)
    expect(effectRuns).toBe(1) // Should have run once

    // Step 8: Update the store
    console.log('\n10. Updating store from 1 to 2...')
    update({ $set: { value: 2 } })
    console.log(`    Store updated, value is now: ${store.value}`)

    // Step 9: Flush microtasks
    console.log('11. Flushing microtasks...')
    await flushMicrotasks()
    console.log('    Microtasks flushed')

    // Check final state
    console.log('\n12. Final state:')
    console.log(`    effectRuns: ${effectRuns}`)
    console.log(`    version: ${version}`)
    console.log(`    store.value: ${store.value}`)
    console.log(
      `    Effect deps: ${
        (effectNode as any)?.deps ? 'still has deps' : 'no deps'
      }`
    )

    // The effect should have run again
    expect(effectRuns).toBe(2)
    expect(version).toBe(1)

    cleanup()
  })

  it('should test if effect is disposed when cleanup is called', async () => {
    console.log('\n=== TEST: Effect disposal ===\n')

    const [store, update] = createStore({ value: 10 })
    let effectRuns = 0

    // Create effect that accesses store
    const cleanup = effect(() => {
      effectRuns++
      const val = store.value
      console.log(`Effect run #${effectRuns}, value: ${val}`)
    })

    expect(effectRuns).toBe(1)

    // Update should trigger effect
    update({ $set: { value: 20 } })
    await flushMicrotasks()
    expect(effectRuns).toBe(2)

    // Clean up the effect
    console.log('Calling cleanup...')
    cleanup()

    // Update again - effect should NOT run
    update({ $set: { value: 30 } })
    await flushMicrotasks()

    console.log(`Final effectRuns: ${effectRuns}`)
    expect(effectRuns).toBe(2) // Should still be 2
  })

  it('should test what happens if we never restore the subscriber', async () => {
    console.log('\n=== TEST: Never restore subscriber ===\n')

    const [store, update] = createStore({ value: 100 })
    let effectRuns = 0

    // Create effect without accessing store
    let effectNode: any = null
    const cleanup = effect(() => {
      effectRuns++
      effectNode = getCurrentSub()
      console.log(`Effect run #${effectRuns}`)
    })

    expect(effectRuns).toBe(1)

    // Set as current subscriber and access store
    setCurrentSub(effectNode)
    const val1 = store.value
    console.log(`Accessed store.value: ${val1}`)
    console.log('Effect deps after access:', (effectNode as any)?.deps)

    // DON'T restore the previous subscriber
    console.log('NOT restoring previous subscriber')
    console.log('Current subscriber is still:', getCurrentSub())

    // Update the store
    update({ $set: { value: 200 } })
    await flushMicrotasks()

    console.log(`After update, effectRuns: ${effectRuns}`)
    expect(effectRuns).toBe(2)

    // Clean up
    setCurrentSub(undefined)
    cleanup()
  })

  it('should test setting subscriber BEFORE effect creation', async () => {
    console.log('\n=== TEST: Set subscriber BEFORE effect creation ===\n')

    const [store, update] = createStore({ value: 1000 })
    let effectRuns = 0
    let lastValue = 0

    // Create a dummy effect first to get a subscriber node
    let dummyNode: any = null
    const dummyCleanup = effect(() => {
      dummyNode = getCurrentSub()
    })
    console.log('1. Created dummy effect to get node')

    // Clean up the dummy effect
    dummyCleanup()
    console.log('2. Cleaned up dummy effect')

    // Now set this node as current subscriber BEFORE creating our real effect
    setCurrentSub(dummyNode)
    console.log('3. Set dummy node as current subscriber')

    // Create our real effect while dummy node is current
    const cleanup = effect(() => {
      effectRuns++
      // Access store inside the effect
      lastValue = store.value
      console.log(`Effect run #${effectRuns}, value: ${lastValue}`)
    })

    console.log('4. Created real effect')
    console.log('   effectRuns:', effectRuns)
    console.log('   Current subscriber:', getCurrentSub())

    // Restore subscriber
    setCurrentSub(undefined)
    console.log('5. Restored subscriber to undefined')

    expect(effectRuns).toBe(1)
    expect(lastValue).toBe(1000)

    // Update store
    console.log('6. Updating store...')
    update({ $set: { value: 2000 } })
    await flushMicrotasks()

    console.log('7. After update:')
    console.log('   effectRuns:', effectRuns)
    console.log('   lastValue:', lastValue)

    expect(effectRuns).toBe(2)
    expect(lastValue).toBe(2000)

    cleanup()
  })

  it('should test if we can manually create tracking context', async () => {
    console.log('\n=== TEST: Manual tracking context ===\n')

    const [store, update] = createStore({ value: 5 })
    let effectRuns = 0
    let trackedValue = 0

    // Create an effect that will track accesses
    let effectNode: any = null
    const cleanup = effect(() => {
      effectRuns++
      const node = getCurrentSub()

      if (!effectNode) {
        effectNode = node
        console.log(`Effect run #${effectRuns} (initial), captured node`)
      } else {
        console.log(`Effect run #${effectRuns} (triggered by change)`)
      }

      // Manually set ourselves as subscriber and access store
      const prevSub = setCurrentSub(effectNode)
      trackedValue = store.value
      console.log(`  Accessed value: ${trackedValue}`)
      setCurrentSub(prevSub)
    })

    expect(effectRuns).toBe(1)
    expect(trackedValue).toBe(5)

    // Update store
    console.log('Updating store...')
    update({ $set: { value: 10 } })
    await flushMicrotasks()

    console.log('After update:')
    console.log('  effectRuns:', effectRuns)
    console.log('  trackedValue:', trackedValue)

    expect(effectRuns).toBe(2)
    expect(trackedValue).toBe(10)

    cleanup()
  })
})
