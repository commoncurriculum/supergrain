import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore, signal, effect } from '@storable/core'
import { useStore } from '../src/use-store'

describe('Debug Tests', () => {
  it('should verify store works without React', () => {
    const store = createStore({ count: 42 })
    expect(store.count).toBe(42)

    store.count = 100
    expect(store.count).toBe(100)
  })

  it('should verify effect tracking works', () => {
    const store = createStore({ count: 0 })
    const spy = vi.fn()

    const cleanup = effect(() => {
      // Access store property to establish tracking
      const value = store.count
      spy(value)
    })

    // Effect should run immediately
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(0)

    // Changing store should trigger effect
    store.count = 5
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith(5)

    cleanup()
  })

  it('should debug useStore hook', () => {
    const store = createStore({ count: 42 })

    function TestComponent() {
      console.log('Rendering TestComponent')
      console.log('Store before useStore:', store)

      const state = useStore(store)

      console.log('State after useStore:', state)
      console.log('State.count:', state.count)
      console.log('Are they the same object?', state === store)

      return (
        <div>
          <div data-testid="count">{state.count}</div>
          <div data-testid="debug">
            state type: {typeof state}, count type: {typeof state.count}, count
            value: {String(state.count)}
          </div>
        </div>
      )
    }

    render(<TestComponent />)

    const countEl = screen.getByTestId('count')
    const debugEl = screen.getByTestId('debug')

    console.log('Count element textContent:', countEl.textContent)
    console.log('Debug element textContent:', debugEl.textContent)

    // This will likely fail but let's see what we get
    expect(countEl.textContent).toBe('42')
  })

  it('should test if store is reactive in component', async () => {
    const store = createStore({ value: 'initial' })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      console.log(`Render #${renderCount}, store.value = ${store.value}`)

      // Try accessing store directly without useStore
      return <div data-testid="value">{store.value}</div>
    }

    render(<TestComponent />)

    console.log('After initial render:')
    console.log('  renderCount:', renderCount)
    console.log('  DOM content:', screen.getByTestId('value').textContent)

    expect(screen.getByTestId('value').textContent).toBe('initial')

    // Change store value
    await act(async () => {
      store.value = 'updated'
    })

    console.log('After store update:')
    console.log('  renderCount:', renderCount)
    console.log('  DOM content:', screen.getByTestId('value').textContent)

    // Without useStore, this won't trigger re-render
    expect(renderCount).toBe(1) // Should still be 1
  })

  it('should test minimal useStore implementation', async () => {
    const store = createStore({ count: 10 })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const state = useStore(store)

      console.log(`Render #${renderCount}`)
      console.log('  typeof state:', typeof state)
      console.log('  state:', state)
      console.log('  state.count:', state?.count)

      // Try different ways to access the value
      const directAccess = state.count
      const bracketAccess = state['count']

      console.log('  directAccess:', directAccess)
      console.log('  bracketAccess:', bracketAccess)

      return (
        <div>
          <div data-testid="render-count">{renderCount}</div>
          <div data-testid="count-direct">{directAccess}</div>
          <div data-testid="count-bracket">{bracketAccess}</div>
          <div data-testid="count-fallback">{state?.count || 'undefined'}</div>
        </div>
      )
    }

    const { rerender } = render(<TestComponent />)

    console.log('After initial render:')
    console.log(
      '  render-count:',
      screen.getByTestId('render-count').textContent
    )
    console.log(
      '  count-direct:',
      screen.getByTestId('count-direct').textContent
    )
    console.log(
      '  count-bracket:',
      screen.getByTestId('count-bracket').textContent
    )
    console.log(
      '  count-fallback:',
      screen.getByTestId('count-fallback').textContent
    )

    // Update store
    await act(async () => {
      console.log('Updating store.count to 20')
      store.count = 20
    })

    console.log('After store update:')
    console.log(
      '  render-count:',
      screen.getByTestId('render-count').textContent
    )
    console.log(
      '  count-direct:',
      screen.getByTestId('count-direct').textContent
    )
    console.log(
      '  count-bracket:',
      screen.getByTestId('count-bracket').textContent
    )
    console.log(
      '  count-fallback:',
      screen.getByTestId('count-fallback').textContent
    )

    // Force a re-render to see if it's a reactivity issue
    rerender(<TestComponent />)

    console.log('After forced rerender:')
    console.log(
      '  render-count:',
      screen.getByTestId('render-count').textContent
    )
    console.log(
      '  count-direct:',
      screen.getByTestId('count-direct').textContent
    )
  })
})
