import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import {
  createStore,
  effect,
  getCurrentSub,
  setCurrentSub,
} from '@storable/core'
import { useReactive } from '../src/use-reactive'
import { flushMicrotasks } from './test-utils'

describe('useReactive Debug', () => {
  it('should debug why useReactive is not working', async () => {
    console.log('\n=== DEBUGGING useReactive ===\n')

    const [store, update] = createStore({ value: 1 })
    let renders = 0
    let effectNodeFromHook: any = null
    let subscriberDuringRender: any = null
    let subscriberAfterAccess: any = null

    function TestComponent() {
      console.log(`\n--- Render #${renders + 1} starting ---`)
      console.log('1. Current subscriber before useReactive:', getCurrentSub())

      useReactive()

      console.log('2. Current subscriber after useReactive:', getCurrentSub())
      subscriberDuringRender = getCurrentSub()

      renders++

      // Access the store
      console.log('3. About to access store.value...')
      const value = store.value
      console.log(`4. Accessed store.value = ${value}`)

      subscriberAfterAccess = getCurrentSub()
      console.log('5. Current subscriber after access:', subscriberAfterAccess)
      console.log(
        '6. Subscriber has deps?:',
        (subscriberAfterAccess as any)?.deps
      )

      // Try to get the effect node from the hook's internals
      // This is a hack for debugging
      const hookRef =
        (TestComponent as any)._hookRef ||
        (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
          ?.ReactCurrentDispatcher?.current?._effectStore
      if (hookRef) {
        effectNodeFromHook = hookRef.effectNode
        console.log('7. Effect node from hook:', effectNodeFromHook)
      }

      return <div data-testid="value">{value}</div>
    }

    render(<TestComponent />)

    console.log('\n--- After initial render ---')
    console.log('Renders:', renders)
    console.log('Subscriber during render:', subscriberDuringRender)
    console.log('Subscriber after access:', subscriberAfterAccess)
    console.log('Effect node deps:', (subscriberDuringRender as any)?.deps)

    expect(renders).toBe(1)
    expect(screen.getByTestId('value').textContent).toBe('1')

    console.log('\n--- About to update store ---')

    await act(async () => {
      console.log('Updating store from 1 to 2...')
      update({ $set: { value: 2 } })
      console.log('Store updated, value is now:', store.value)

      console.log('Flushing microtasks...')
      await flushMicrotasks()
      console.log('Microtasks flushed')

      // Try additional flush methods
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    console.log('\n--- After update ---')
    console.log('Renders:', renders)
    console.log('DOM value:', screen.getByTestId('value').textContent)

    // This should be 2 if the component re-rendered
    expect(renders).toBe(2)
    expect(screen.getByTestId('value').textContent).toBe('2')
  })

  it('should compare with manual effect tracking', async () => {
    console.log('\n=== COMPARING WITH MANUAL TRACKING ===\n')

    const [store, update] = createStore({ value: 10 })
    let manualEffectRuns = 0
    let hookBasedRenders = 0

    // First, test manual effect tracking that we know works
    console.log('--- Manual tracking test ---')
    let manualEffectNode: any = null
    const manualCleanup = effect(() => {
      manualEffectRuns++
      manualEffectNode = getCurrentSub()
      console.log(`Manual effect run #${manualEffectRuns}`)
    })

    console.log('Manual effect created, node:', manualEffectNode)
    console.log(
      'Manual effect deps initially:',
      (manualEffectNode as any)?.deps
    )

    // Manually set as subscriber and access store
    const prevSub = setCurrentSub(manualEffectNode)
    const val1 = store.value
    console.log(`Accessed store.value = ${val1} with manual subscriber`)
    setCurrentSub(prevSub)

    console.log(
      'Manual effect deps after access:',
      (manualEffectNode as any)?.deps
    )

    // Update and check if manual effect runs
    update({ $set: { value: 20 } })
    await flushMicrotasks()

    console.log(`Manual effect runs after update: ${manualEffectRuns}`)
    expect(manualEffectRuns).toBe(2) // Should be 2 if working

    manualCleanup()

    // Reset for hook test
    update({ $set: { value: 10 } })
    await flushMicrotasks()

    // Now test with useReactive hook
    console.log('\n--- Hook-based tracking test ---')

    function HookComponent() {
      useReactive()
      hookBasedRenders++
      console.log(`Hook component render #${hookBasedRenders}`)
      console.log('Current subscriber in component:', getCurrentSub())

      const value = store.value
      console.log(`Accessed store.value = ${value} in component`)

      return <div data-testid="hook-value">{value}</div>
    }

    render(<HookComponent />)

    console.log('Initial hook renders:', hookBasedRenders)
    expect(hookBasedRenders).toBe(1)

    // Update and check if hook component re-renders
    await act(async () => {
      update({ $set: { value: 30 } })
      await flushMicrotasks()
    })

    console.log('Hook renders after update:', hookBasedRenders)
    expect(hookBasedRenders).toBe(2) // Should be 2 if working
  })

  it('should test if effect is properly initialized in useReactive', () => {
    console.log('\n=== TESTING EFFECT INITIALIZATION ===\n')

    // Create a mock component to inspect the hook's internals
    let capturedEffect: any = null
    let capturedNode: any = null

    // Temporarily override effect to capture what's created
    const originalEffect = effect
    let effectCallCount = 0

    ;(globalThis as any).effect = (callback: () => void) => {
      effectCallCount++
      console.log(`Effect created, call #${effectCallCount}`)

      // Call the original effect
      const cleanup = originalEffect(callback)

      // Capture the node
      const node = getCurrentSub()
      console.log('Effect node after creation:', node)
      console.log('Effect callback:', callback.toString().substring(0, 100))

      capturedEffect = cleanup
      capturedNode = node

      return cleanup
    }

    const [store] = createStore({ test: 'value' })

    function TestComponent() {
      useReactive()
      return <div>{store.test}</div>
    }

    render(<TestComponent />)

    // Restore original effect
    ;(globalThis as any).effect = originalEffect

    console.log('Effect was created:', !!capturedEffect)
    console.log('Effect node captured:', !!capturedNode)
    console.log('Effect node type:', typeof capturedNode)
    console.log('Effect node has deps?:', !!(capturedNode as any)?.deps)

    if (capturedEffect) {
      capturedEffect() // Cleanup
    }
  })

  it('should test subscriber context timing', async () => {
    console.log('\n=== TESTING SUBSCRIBER CONTEXT TIMING ===\n')

    const [store, update] = createStore({ num: 100 })
    const subscriberLog: Array<{ phase: string; subscriber: any }> = []

    function LoggingComponent() {
      subscriberLog.push({
        phase: 'start-of-render',
        subscriber: getCurrentSub(),
      })

      useReactive()

      subscriberLog.push({
        phase: 'after-useReactive',
        subscriber: getCurrentSub(),
      })

      const value = store.num

      subscriberLog.push({
        phase: 'after-store-access',
        subscriber: getCurrentSub(),
      })

      React.useLayoutEffect(() => {
        subscriberLog.push({
          phase: 'in-layout-effect',
          subscriber: getCurrentSub(),
        })

        return () => {
          subscriberLog.push({
            phase: 'layout-effect-cleanup',
            subscriber: getCurrentSub(),
          })
        }
      })

      return <div>{value}</div>
    }

    render(<LoggingComponent />)

    // Wait for effects to run
    await act(async () => {
      await Promise.resolve()
    })

    console.log('\nSubscriber context at different phases:')
    subscriberLog.forEach(({ phase, subscriber }) => {
      console.log(
        `  ${phase}:`,
        subscriber ? 'EXISTS' : 'null',
        subscriber?.deps ? '(has deps)' : '(no deps)'
      )
    })

    // Now update and see what happens
    console.log('\nUpdating store...')
    subscriberLog.length = 0 // Clear log

    await act(async () => {
      update({ $set: { num: 200 } })
      await flushMicrotasks()
    })

    console.log('\nSubscriber context during update:')
    subscriberLog.forEach(({ phase, subscriber }) => {
      console.log(
        `  ${phase}:`,
        subscriber ? 'EXISTS' : 'null',
        subscriber?.deps ? '(has deps)' : '(no deps)'
      )
    })
  })
})
