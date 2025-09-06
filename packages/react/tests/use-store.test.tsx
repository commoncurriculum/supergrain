import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useStore } from '../src/use-store'

describe('useStore', () => {
  afterEach(() => {
    cleanup()
  })

  it('should render with initial store values', () => {
    const store = createStore({ count: 0 })

    function Counter() {
      const state = useStore(store)
      return <div data-testid="count">{state.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('should re-render when store values change', async () => {
    const store = createStore({ count: 0 })

    function Counter() {
      const state = useStore(store)
      return <div data-testid="count">{state.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    // Update the store
    await act(async () => {
      store.count = 1
    })

    expect(screen.getByTestId('count').textContent).toBe('1')

    // Update again
    await act(async () => {
      store.count = 5
    })

    expect(screen.getByTestId('count').textContent).toBe('5')
  })

  it('should only re-render when accessed properties change', async () => {
    const store = createStore({ count: 0, name: 'test' })
    const renderSpy = vi.fn()

    function Counter() {
      const state = useStore(store)
      renderSpy()
      // Only accessing count, not name
      return <div data-testid="count">{state.count}</div>
    }

    render(<Counter />)
    expect(renderSpy).toHaveBeenCalledTimes(1)

    // Update the name (not accessed)
    await act(async () => {
      store.name = 'updated'
    })

    // Should not re-render since name is not accessed
    expect(renderSpy).toHaveBeenCalledTimes(1)

    // Update the count (accessed)
    await act(async () => {
      store.count = 1
    })

    // Should re-render since count is accessed
    expect(renderSpy).toHaveBeenCalledTimes(2)
  })

  it('should handle multiple components using the same store', async () => {
    const store = createStore({ count: 0 })

    function Counter1() {
      const state = useStore(store)
      return <div data-testid="counter1">{state.count}</div>
    }

    function Counter2() {
      const state = useStore(store)
      return <div data-testid="counter2">{state.count * 2}</div>
    }

    render(
      <>
        <Counter1 />
        <Counter2 />
      </>
    )

    expect(screen.getByTestId('counter1').textContent).toBe('0')
    expect(screen.getByTestId('counter2').textContent).toBe('0')

    await act(async () => {
      store.count = 5
    })

    expect(screen.getByTestId('counter1').textContent).toBe('5')
    expect(screen.getByTestId('counter2').textContent).toBe('10')
  })

  it('should clean up on unmount', () => {
    const store = createStore({ count: 0 })

    function Counter() {
      const state = useStore(store)
      return <div data-testid="count">{state.count}</div>
    }

    const { unmount } = render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    // Unmount the component
    unmount()

    // Update the store after unmount
    act(() => {
      store.count = 1
    })

    // Component should be unmounted, no errors should occur
    expect(screen.queryByTestId('count')).toBeNull()
  })

  it('should handle nested object updates', async () => {
    const store = createStore({
      user: {
        name: 'John',
        age: 30,
      },
    })

    function UserInfo() {
      const state = useStore(store)
      return (
        <div>
          <span data-testid="name">{state.user.name}</span>
          <span data-testid="age">{state.user.age}</span>
        </div>
      )
    }

    render(<UserInfo />)
    expect(screen.getByTestId('name').textContent).toBe('John')
    expect(screen.getByTestId('age').textContent).toBe('30')

    await act(async () => {
      store.user.name = 'Jane'
    })

    expect(screen.getByTestId('name').textContent).toBe('Jane')
    expect(screen.getByTestId('age').textContent).toBe('30')
  })

  it('should handle array updates', async () => {
    const store = createStore({
      items: ['a', 'b', 'c'],
    })

    function ItemList() {
      const state = useStore(store)
      return (
        <ul data-testid="list">
          {state.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    }

    render(<ItemList />)
    const list = screen.getByTestId('list')
    expect(list.children.length).toBe(3)
    expect(list.children[0].textContent).toBe('a')

    await act(async () => {
      store.items.push('d')
    })

    expect(list.children.length).toBe(4)
    expect(list.children[3].textContent).toBe('d')

    await act(async () => {
      store.items[0] = 'z'
    })

    expect(list.children[0].textContent).toBe('z')
  })
})
