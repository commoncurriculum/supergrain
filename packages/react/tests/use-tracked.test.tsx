import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore, unwrap, readSignal, setProperty, startBatch, endBatch } from '@supergrain/core'
import { useTracked } from '../src'

describe('useTracked', () => {
  it('returns the value passed in', () => {
    const [store] = createStore({ title: 'hello' })

    function TestComponent() {
      const tracked = useTracked(store)
      // useTracked returns the same reference
      return <div data-testid="title">{String(tracked === store)}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('title').textContent).toBe('true')
  })

  it('re-renders when tracked signal changes', () => {
    const [store] = createStore({ title: 'hello' })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const tracked = useTracked(store)
      // Simulate what the plugin would compile: store.title → readSignal(store, 'title')()
      const title = readSignal(tracked, 'title')()
      return <div data-testid="title">{title as string}</div>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('title').textContent).toBe('hello')
    expect(renderCount).toBe(1)

    act(() => {
      startBatch()
      setProperty(unwrap(store) as any, 'title', 'world')
      endBatch()
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
      const title = readSignal(tracked, 'title')()
      return <div data-testid="title">{title as string}</div>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    // Update count (not tracked by this component)
    act(() => {
      startBatch()
      setProperty(unwrap(store) as any, 'count', 42)
      endBatch()
    })

    // Should NOT re-render
    expect(renderCount).toBe(1)

    // Update title (tracked)
    act(() => {
      startBatch()
      setProperty(unwrap(store) as any, 'title', 'world')
      endBatch()
    })

    // Should re-render
    expect(renderCount).toBe(2)
  })
})
