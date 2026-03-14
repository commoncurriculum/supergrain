import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore } from '@supergrain/core'
import { useTracked } from '../src'

describe('useTracked', () => {
  it('returns a proxy that provides access to store values', () => {
    const [store] = createStore({ title: 'hello' })

    function TestComponent() {
      const tracked = useTracked(store)
      // useTracked returns a proxy wrapping the store
      return <div data-testid="title">{tracked.title}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('title').textContent).toBe('hello')
  })

  it('re-renders when tracked signal changes', () => {
    const [store] = createStore({ title: 'hello' })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const tracked = useTracked(store)
      // Access through proxy to establish tracking
      const title = tracked.title
      return <div data-testid="title">{title}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('title').textContent).toBe('hello')
    expect(renderCount).toBe(1)

    act(() => {
      store.title = 'world'
    })

    expect(screen.getByTestId('title').textContent).toBe('world')
    expect(renderCount).toBe(2)
  })

  it('only re-renders for tracked properties', () => {
    const [store] = createStore({ title: 'hello', count: 0 })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const tracked = useTracked(store)
      // Only access title — count is not tracked
      const title = tracked.title
      return <div data-testid="title">{title}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    // Update count (not tracked by this component)
    act(() => {
      store.count = 42
    })

    // Should NOT re-render
    expect(renderCount).toBe(1)

    // Update title (tracked)
    act(() => {
      store.title = 'world'
    })

    // Should re-render
    expect(renderCount).toBe(2)
  })
})
