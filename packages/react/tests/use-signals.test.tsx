import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useSignals, useStore } from '../src/use-signals'

describe('useSignals', () => {
  afterEach(() => {
    cleanup()
  })

  it('should render initial store value with useSignals', () => {
    const [store] = createStore({ count: 42 })

    function Counter() {
      useSignals()
      return <div data-testid="count">{store.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('42')
  })

  it('should re-render when store changes with useSignals', async () => {
    const [store, update] = createStore({ count: 0 })

    function Counter() {
      useSignals()
      return <div data-testid="count">{store.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    await act(async () => {
      update({ $set: { count: 10 } })
    })

    expect(screen.getByTestId('count').textContent).toBe('10')
  })

  it('should work with useStore convenience hook', async () => {
    const [store, update] = createStore({ message: 'hello' })

    function Display() {
      const state = useStore(store)
      return <div data-testid="message">{state.message}</div>
    }

    render(<Display />)
    expect(screen.getByTestId('message').textContent).toBe('hello')

    await act(async () => {
      update({ $set: { message: 'world' } })
    })

    expect(screen.getByTestId('message').textContent).toBe('world')
  })

  it('should handle multiple components observing same store', async () => {
    const [store, update] = createStore({ value: 100 })

    function DisplayA() {
      useSignals()
      return <div data-testid="display-a">{store.value}</div>
    }

    function DisplayB() {
      useSignals()
      return <div data-testid="display-b">{store.value * 2}</div>
    }

    render(
      <>
        <DisplayA />
        <DisplayB />
      </>
    )

    expect(screen.getByTestId('display-a').textContent).toBe('100')
    expect(screen.getByTestId('display-b').textContent).toBe('200')

    await act(async () => {
      update({ $set: { value: 50 } })
    })

    expect(screen.getByTestId('display-a').textContent).toBe('50')
    expect(screen.getByTestId('display-b').textContent).toBe('100')
  })

  it('should only re-render components that access changed properties', async () => {
    const [store, update] = createStore({
      name: 'John',
      age: 30,
    })

    let nameRenders = 0
    let ageRenders = 0

    function NameDisplay() {
      useSignals()
      nameRenders++
      return <div data-testid="name">{store.name}</div>
    }

    function AgeDisplay() {
      useSignals()
      ageRenders++
      return <div data-testid="age">{store.age}</div>
    }

    render(
      <>
        <NameDisplay />
        <AgeDisplay />
      </>
    )

    expect(nameRenders).toBe(1)
    expect(ageRenders).toBe(1)

    // Update only age
    await act(async () => {
      update({ $set: { age: 31 } })
    })

    // Only AgeDisplay should re-render
    expect(nameRenders).toBe(1)
    expect(ageRenders).toBe(2)
    expect(screen.getByTestId('age').textContent).toBe('31')
  })

  it('should handle nested object updates', async () => {
    const [store, update] = createStore({
      user: {
        name: 'Alice',
        settings: {
          theme: 'dark',
        },
      },
    })

    function UserInfo() {
      useSignals()
      return (
        <div>
          <span data-testid="name">{store.user.name}</span>
          <span data-testid="theme">{store.user.settings.theme}</span>
        </div>
      )
    }

    render(<UserInfo />)
    expect(screen.getByTestId('name').textContent).toBe('Alice')
    expect(screen.getByTestId('theme').textContent).toBe('dark')

    await act(async () => {
      update({ $set: { 'user.settings.theme': 'light' } })
    })

    expect(screen.getByTestId('theme').textContent).toBe('light')
    expect(screen.getByTestId('name').textContent).toBe('Alice')
  })

  it('should handle array operations', async () => {
    const [store, update] = createStore({
      items: ['a', 'b', 'c'],
    })

    function ItemList() {
      useSignals()
      return (
        <ul data-testid="list">
          {store.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )
    }

    render(<ItemList />)
    const list = screen.getByTestId('list')
    expect(list.children.length).toBe(3)

    await act(async () => {
      update({ $push: { items: 'd' } })
    })

    expect(list.children.length).toBe(4)
    expect(list.children[3].textContent).toBe('d')
  })

  it('should handle conditional rendering', async () => {
    const [store, update] = createStore({
      showMessage: true,
      message: 'Hello',
    })

    function ConditionalDisplay() {
      useSignals()
      return (
        <div>
          {store.showMessage && (
            <div data-testid="message">{store.message}</div>
          )}
        </div>
      )
    }

    render(<ConditionalDisplay />)
    expect(screen.getByTestId('message').textContent).toBe('Hello')

    await act(async () => {
      update({ $set: { showMessage: false } })
    })

    expect(screen.queryByTestId('message')).toBeNull()

    await act(async () => {
      update({ $set: { showMessage: true, message: 'World' } })
    })

    expect(screen.getByTestId('message').textContent).toBe('World')
  })

  it('should handle rapid updates', async () => {
    const [store, update] = createStore({ counter: 0 })

    function Counter() {
      useSignals()
      return <div data-testid="counter">{store.counter}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('counter').textContent).toBe('0')

    await act(async () => {
      update({ $set: { counter: 1 } })
      update({ $set: { counter: 2 } })
      update({ $set: { counter: 3 } })
      update({ $set: { counter: 4 } })
      update({ $set: { counter: 5 } })
    })

    expect(screen.getByTestId('counter').textContent).toBe('5')
  })

  it('should clean up on unmount', async () => {
    const [store, update] = createStore({ value: 'test' })

    function TestComponent() {
      useSignals()
      return <div data-testid="value">{store.value}</div>
    }

    const { unmount } = render(<TestComponent />)
    expect(screen.getByTestId('value').textContent).toBe('test')

    unmount()

    // Updates after unmount should not cause errors
    update({ $set: { value: 'updated' } })

    expect(screen.queryByTestId('value')).toBeNull()
  })
})
