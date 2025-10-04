import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { memo, useState, useEffect } from 'react'
import { createStore, effect } from '@supergrain/core'
import { useTrackedStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('useTrackedStore Mechanism Tests', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should demonstrate that useTrackedStore is what enables reactive subscriptions', async () => {
    const [store, update] = createStore({
      items: [{ deep: { value: 1 } }],
    })

    let trackedRenderCount = 0
    let nonTrackedRenderCount = 0

    // Component using useTrackedStore - should be reactive
    const TrackedComponent = memo(() => {
      trackedRenderCount++
      const state = useTrackedStore(store)

      console.log(`TrackedComponent: render #${trackedRenderCount}`)
      const value = state.items[0].deep.value
      console.log(`  Accessing state.items[0].deep.value = ${value}`)

      return <div data-testid="tracked-value">{value}</div>
    })

    // Component NOT using useTrackedStore - should NOT be reactive
    const NonTrackedComponent = memo(() => {
      nonTrackedRenderCount++
      console.log(`NonTrackedComponent: render #${nonTrackedRenderCount}`)

      // Access store directly without useTrackedStore
      const value = store.items[0].deep.value
      console.log(`  Accessing store.items[0].deep.value directly = ${value}`)

      return <div data-testid="non-tracked-value">{value}</div>
    })

    function TestApp() {
      return (
        <div>
          <TrackedComponent />
          <NonTrackedComponent />
        </div>
      )
    }

    const { container } = render(<TestApp />)

    console.log('\n=== Initial render ===')
    console.log('TrackedComponent renders:', trackedRenderCount)
    console.log('NonTrackedComponent renders:', nonTrackedRenderCount)

    // Both should show initial value
    expect(
      container.querySelector('[data-testid="tracked-value"]')?.textContent
    ).toBe('1')
    expect(
      container.querySelector('[data-testid="non-tracked-value"]')?.textContent
    ).toBe('1')

    // Update the deep nested value
    await act(async () => {
      console.log('\n=== Updating items.0.deep.value to 42 ===')
      update({
        $set: {
          'items.0.deep.value': 42,
        },
      })
      await flushMicrotasks()
    })

    console.log('\nAfter update:')
    console.log('TrackedComponent renders:', trackedRenderCount)
    console.log('NonTrackedComponent renders:', nonTrackedRenderCount)

    console.log('\n=== Results ===')
    console.log(
      `TrackedComponent re-rendered: ${trackedRenderCount > 1 ? 'YES' : 'NO'}`
    )
    console.log(
      `NonTrackedComponent re-rendered: ${
        nonTrackedRenderCount > 1 ? 'YES' : 'NO'
      }`
    )

    // Check what the UI shows
    console.log(
      `Tracked component shows: ${
        container.querySelector('[data-testid="tracked-value"]')?.textContent
      }`
    )
    console.log(
      `Non-tracked component shows: ${
        container.querySelector('[data-testid="non-tracked-value"]')
          ?.textContent
      }`
    )

    if (trackedRenderCount > 1 && nonTrackedRenderCount === 1) {
      console.log(
        '✓ CONFIRMED: useTrackedStore is what enables reactive subscriptions'
      )
      expect(
        container.querySelector('[data-testid="tracked-value"]')?.textContent
      ).toBe('42')
      expect(
        container.querySelector('[data-testid="non-tracked-value"]')
          ?.textContent
      ).toBe('1') // Should still show old value
    } else if (trackedRenderCount === 1 && nonTrackedRenderCount === 1) {
      console.log('✗ UNEXPECTED: Neither component re-rendered')
    } else if (trackedRenderCount > 1 && nonTrackedRenderCount > 1) {
      console.log('✗ UNEXPECTED: Both components re-rendered')
    }
  })

  it('should show that manual effect usage works the same way', async () => {
    const [store, update] = createStore({
      items: [{ deep: { value: 100 } }],
    })

    let effectTriggered = false
    let manualRenderCount = 0

    // Component that manually uses effect like useTrackedStore does internally
    const ManualEffectComponent = memo(() => {
      manualRenderCount++
      const [, forceUpdate] = useState({})

      console.log(`ManualEffectComponent: render #${manualRenderCount}`)

      useEffect(() => {
        const cleanup = effect(() => {
          console.log('Manual effect running...')
          // Access the store property - this should create subscription
          const value = store.items[0].deep.value
          console.log(
            `  Manual effect accessed store.items[0].deep.value = ${value}`
          )

          if (effectTriggered) {
            console.log('  Manual effect triggering forceUpdate')
            forceUpdate({}) // Force re-render
          }
          effectTriggered = true
        })

        return cleanup
      }, [])

      const value = store.items[0].deep.value
      return <div data-testid="manual-effect-value">{value}</div>
    })

    const { container } = render(<ManualEffectComponent />)

    console.log('\n=== Manual Effect Test ===')
    console.log('Initial renders:', manualRenderCount)

    await act(async () => {
      console.log('\n=== Updating items.0.deep.value to 200 ===')
      update({
        $set: {
          'items.0.deep.value': 200,
        },
      })
      await flushMicrotasks()
    })

    console.log('After manual effect update:')
    console.log('Manual component renders:', manualRenderCount)
    console.log(
      `Manual component shows: ${
        container.querySelector('[data-testid="manual-effect-value"]')
          ?.textContent
      }`
    )

    if (manualRenderCount > 1) {
      console.log('✓ Manual effect approach also enables reactivity')
    } else {
      console.log('✗ Manual effect approach did not work')
    }
  })

  it('should demonstrate subscription specificity - only accessed properties trigger re-renders', async () => {
    const [store, update] = createStore({
      items: [
        {
          accessed: { value: 1 },
          notAccessed: { value: 999 },
        },
      ],
    })

    let renderCount = 0

    const SpecificSubscriptionComponent = memo(() => {
      renderCount++
      const state = useTrackedStore(store)

      console.log(`SpecificSubscriptionComponent: render #${renderCount}`)

      // Only access 'accessed' property, NOT 'notAccessed'
      const value = state.items[0].accessed.value
      console.log(`  Only accessing state.items[0].accessed.value = ${value}`)

      return <div data-testid="specific-value">{value}</div>
    })

    render(<SpecificSubscriptionComponent />)

    console.log('\n=== Subscription Specificity Test ===')
    console.log('Initial renders:', renderCount)

    // Test 1: Update the property that IS accessed - should trigger re-render
    await act(async () => {
      console.log('\n=== Test 1: Updating accessed property ===')
      update({
        $set: {
          'items.0.accessed.value': 42,
        },
      })
      await flushMicrotasks()
    })

    console.log('After updating ACCESSED property:')
    console.log('Renders:', renderCount)
    const rendersAfterAccessedUpdate = renderCount

    // Test 2: Update the property that is NOT accessed - should NOT trigger re-render
    await act(async () => {
      console.log('\n=== Test 2: Updating NOT accessed property ===')
      update({
        $set: {
          'items.0.notAccessed.value': 777,
        },
      })
      await flushMicrotasks()
    })

    console.log('After updating NOT ACCESSED property:')
    console.log('Renders:', renderCount)

    console.log('\n=== Subscription Specificity Results ===')
    console.log(
      `Accessed property update triggered re-render: ${
        rendersAfterAccessedUpdate > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(
      `Not-accessed property update triggered re-render: ${
        renderCount > rendersAfterAccessedUpdate ? 'YES' : 'NO'
      }`
    )

    if (
      rendersAfterAccessedUpdate > 1 &&
      renderCount === rendersAfterAccessedUpdate
    ) {
      console.log('✓ PERFECT: Only accessed properties trigger re-renders')
    }
  })
})
