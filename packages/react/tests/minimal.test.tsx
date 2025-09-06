import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import {
  createStore,
  effect,
  getCurrentSub,
  setCurrentSub,
} from '@storable/core'
import { useStore } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('Minimal Reactivity Tests', () => {
  it('should verify basic effect tracking works', async () => {
    const [store, update] = createStore({ count: 0 })
    let effectCount = 0

    // Create an effect that tracks store.count
    const cleanup = effect(() => {
      const value = store.count
      effectCount++
      console.log(`Effect ran ${effectCount} times, count = ${value}`)
    })

    expect(effectCount).toBe(1) // Effect runs immediately

    // Update should trigger effect
    update({ $set: { count: 5 } })
    await flushMicrotasks()
    expect(effectCount).toBe(2) // Effect should run again

    cleanup()
  })

  it('should debug what happens during useStore', async () => {
    const [store, update] = createStore({ count: 10 })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      console.log(`=== Render ${renderCount} ===`)

      // Check if there's a current subscriber before useStore
      console.log('Current subscriber before useStore:', getCurrentSub())

      const state = useStore(store)

      // Check if there's a current subscriber after useStore
      console.log('Current subscriber after useStore:', getCurrentSub())

      // Access the property - this should be tracked if there's an active effect
      console.log('Accessing state.count:', state.count)
      console.log('Current subscriber after access:', getCurrentSub())

      return <div data-testid="count">{state.count}</div>
    }

    const { rerender } = render(<TestComponent />)

    console.log('\n--- After initial render ---')
    console.log('Render count:', renderCount)
    console.log('DOM content:', screen.getByTestId('count').textContent)

    // Update the store
    console.log('\n--- Updating store ---')
    await act(async () => {
      update({ $set: { count: 20 } })
      await flushMicrotasks()
    })

    console.log('\n--- After update ---')
    console.log('Render count:', renderCount)
    console.log('DOM content:', screen.getByTestId('count').textContent)

    // Force a re-render to see if the value has changed
    console.log('\n--- Force re-render ---')
    rerender(<TestComponent />)

    console.log('\n--- After forced re-render ---')
    console.log('Render count:', renderCount)
    console.log('DOM content:', screen.getByTestId('count').textContent)
  })

  it('should test manual effect setup during render', () => {
    const [store, update] = createStore({ value: 'hello' })
    let renderCount = 0
    let version = 0
    let effectCleanup: (() => void) | null = null

    function TestComponent() {
      renderCount++
      console.log(`\n=== Manual Effect Test - Render ${renderCount} ===`)

      // Manually create an effect during render
      if (effectCleanup) {
        console.log('Cleaning up previous effect')
        effectCleanup()
      }

      console.log('Creating new effect')
      effectCleanup = effect(() => {
        console.log('Effect callback running')
        console.log('Current subscriber in effect:', getCurrentSub())

        // Access store property to establish tracking
        const val = store.value
        console.log('Accessed store.value in effect:', val)

        // This should run when store.value changes
        version++
        console.log('Version incremented to:', version)
      })

      // Now access the store outside the effect
      console.log('Accessing store.value in render:', store.value)

      return (
        <div>
          <div data-testid="value">{store.value}</div>
          <div data-testid="version">{version}</div>
          <div data-testid="renders">{renderCount}</div>
        </div>
      )
    }

    render(<TestComponent />)

    console.log('\n--- Initial render complete ---')
    console.log('Value:', screen.getByTestId('value').textContent)
    console.log('Version:', screen.getByTestId('version').textContent)
    console.log('Renders:', screen.getByTestId('renders').textContent)

    console.log('\n--- Updating store ---')
    act(() => {
      update({ $set: { value: 'world' } })
    })

    console.log('\n--- After update ---')
    console.log('Value:', screen.getByTestId('value').textContent)
    console.log('Version:', screen.getByTestId('version').textContent)
    console.log('Renders:', screen.getByTestId('renders').textContent)

    if (effectCleanup) {
      effectCleanup()
    }
  })

  it('should test if store proxy is reactive', async () => {
    const [store, update] = createStore({ num: 100 })

    // Test that the store is actually a proxy
    console.log('Store type:', typeof store)
    console.log('Is store a proxy?', store.constructor.name !== 'Object')

    // Try to track access manually
    let accessCount = 0
    const cleanup = effect(() => {
      console.log('Effect starting, current sub:', getCurrentSub())
      const value = store.num
      accessCount++
      console.log(`Access ${accessCount}: store.num = ${value}`)
    })

    console.log('After initial effect, accessCount:', accessCount)

    // Update and see if effect runs
    update({ $set: { num: 200 } })
    console.log('After update, accessCount:', accessCount)

    cleanup()
  })
})
