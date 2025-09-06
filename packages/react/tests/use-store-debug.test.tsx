import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import {
  createStore,
  effect,
  getCurrentSub,
  setCurrentSub,
  startBatch,
  endBatch,
} from '@storable/core'

// Access internal batch depth for debugging
declare const globalThis: any
import { useStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('useStore Debug', () => {
  it('should trigger re-render on store update', async () => {
    const [store, update] = createStore({ value: 1 })
    let renders = 0

    function Test() {
      renders++
      console.log(`\n[Test render #${renders}] Starting render`)
      console.log('[Test] Current subscriber before useStore:', getCurrentSub())

      const state = useStore(store)

      console.log('[Test] Current subscriber after useStore:', getCurrentSub())
      console.log('[Test] About to access state.value...')
      const value = state.value
      console.log(
        `[Test] Accessed state.value = ${value}, current sub:`,
        getCurrentSub()
      )

      // Log when component unmounts
      React.useEffect(() => {
        console.log(`[Test render #${renders}] useEffect setup`)
        return () => {
          console.log(`[Test render #${renders}] useEffect cleanup`)
        }
      }, [])

      React.useLayoutEffect(() => {
        console.log(`[Test render #${renders}] useLayoutEffect setup`)
        return () => {
          console.log(`[Test render #${renders}] useLayoutEffect cleanup`)
        }
      }, [])

      return <div data-testid="val">{value}</div>
    }

    const { container } = render(<Test />)

    // Get a reference to the effect store for debugging
    const storeRef =
      (container as any)._reactRootContainer?._internalRoot?.current
        ?.memoizedState?.element?.ref ||
      (Test as any).effectStore ||
      {}
    console.log('\n[Main test] After initial render')
    expect(renders).toBe(1)
    expect(screen.getByTestId('val').textContent).toBe('1')

    console.log('\n[Main test] About to update store')

    // Log the effect state before update
    const effectNode = (storeRef as any).current?.effectNode
    console.log('[Main test] Effect node before update:', {
      exists: !!effectNode,
      deps: effectNode?.deps ? 'has deps' : 'no deps',
      flags: effectNode?.flags,
    })

    await act(async () => {
      console.log('[Main test] Inside act, calling update')

      // Check batch depth before update
      console.log(
        '[Main test] Batch depth before update:',
        (globalThis as any).batchDepth || 'unknown'
      )

      update({ $set: { value: 2 } })

      console.log('[Main test] Update called, store.value is now:', store.value)
      console.log(
        '[Main test] Batch depth after update:',
        (globalThis as any).batchDepth || 'unknown'
      )

      // Check if effect is marked dirty
      console.log('[Main test] Effect flags after update:', effectNode?.flags)

      console.log(
        '[Main test] About to flush microtasks - method 1: await Promise.resolve()'
      )
      await Promise.resolve()
      console.log(
        '[Main test] Promise.resolve() done, batch depth:',
        (globalThis as any).batchDepth || 'unknown'
      )
      console.log(
        '[Main test] Effect flags after Promise.resolve():',
        effectNode?.flags
      )

      console.log(
        '[Main test] About to flush microtasks - method 2: another await'
      )
      await Promise.resolve()
      console.log('[Main test] Second Promise.resolve() done')
      console.log(
        '[Main test] Effect flags after second Promise.resolve():',
        effectNode?.flags
      )

      console.log(
        '[Main test] About to flush microtasks - method 3: setImmediate (if available)'
      )
      await new Promise(resolve => {
        if (typeof setImmediate !== 'undefined') {
          setImmediate(resolve)
        } else {
          setTimeout(resolve, 0)
        }
      })
      console.log('[Main test] setImmediate/setTimeout done')
      console.log(
        '[Main test] Effect flags after setImmediate:',
        effectNode?.flags
      )

      // Try manually ending batch to force effect execution
      console.log(
        '[Main test] Manually calling startBatch/endBatch to force flush'
      )
      console.log(
        '[Main test] Batch depth before manual batch:',
        (globalThis as any).batchDepth || 'unknown'
      )
      startBatch()
      console.log(
        '[Main test] After startBatch, depth:',
        (globalThis as any).batchDepth || 'unknown'
      )
      endBatch()
      console.log(
        '[Main test] After endBatch, depth:',
        (globalThis as any).batchDepth || 'unknown'
      )
      console.log(
        '[Main test] Effect flags after manual batch:',
        effectNode?.flags
      )
    })

    console.log('[Main test] After act completed')
    console.log('[Main test] Final effect flags:', effectNode?.flags)
    console.log(
      '[Main test] Final batch depth:',
      (globalThis as any).batchDepth || 'unknown'
    )
    console.log('[Main test] Renders count:', renders)

    expect(renders).toBe(2)
    expect(screen.getByTestId('val').textContent).toBe('2')
  })

  it('should verify store access tracking with active subscriber', async () => {
    const [store, update] = createStore({ x: 1 })
    let tracked = false
    let trackCount = 0

    console.log('\n=== Store access tracking test ===')

    // Create effect and manually track store access
    const cleanup = effect(() => {
      trackCount++
      console.log(`Effect triggered, count: ${trackCount}`)
      tracked = true
    })

    console.log('Effect created, trackCount:', trackCount)

    // Access store with active subscriber
    const sub = getCurrentSub()
    console.log('Current subscriber after effect creation:', sub)
    if (sub) {
      const val = store.x
      console.log('Accessed store.x with active sub:', val)
    }

    // Update and check if tracked
    console.log('Updating store...')
    update({ $set: { x: 2 } })
    console.log('Store updated, flushing microtasks...')
    await flushMicrotasks()
    console.log('Microtasks flushed, trackCount:', trackCount)

    expect(tracked).toBe(true)
    cleanup()
  })

  it('should verify store creates dependencies when accessed with subscriber', async () => {
    const [store, update] = createStore({ value: 10 })
    let effectRuns = 0
    let lastValue = 0

    console.log('\n=== Dependency creation test ===')

    // Create effect that accesses store
    const cleanup = effect(() => {
      effectRuns++
      const sub = getCurrentSub()
      console.log(`[Dependency test] Effect starting run #${effectRuns}`)
      console.log('[Dependency test] Current subscriber:', sub)

      lastValue = store.value
      console.log(`[Dependency test] Accessed store.value = ${lastValue}`)

      console.log(
        '[Dependency test] Effect subscriber after access:',
        getCurrentSub()
      )
      console.log(
        '[Dependency test] Effect deps after access:',
        (getCurrentSub() as any)?.deps
      )
    })

    console.log('After effect creation:')
    console.log('  effectRuns:', effectRuns)
    console.log('  lastValue:', lastValue)
    expect(effectRuns).toBe(1)
    expect(lastValue).toBe(10)

    // Update store and verify effect runs again
    console.log('\nUpdating store from 10 to 20...')
    update({ $set: { value: 20 } })
    console.log('Store updated, value is now:', store.value)
    console.log('Flushing microtasks...')
    await flushMicrotasks()
    console.log('Microtasks flushed')
    console.log('  effectRuns:', effectRuns)
    console.log('  lastValue:', lastValue)

    expect(effectRuns).toBe(2)
    expect(lastValue).toBe(20)

    cleanup()
  })
})
