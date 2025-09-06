import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { createStore } from '@storable/core'
import { useSignals, useStore } from '../src/use-signals'

describe('useSignals with async updates', () => {
  afterEach(() => {
    cleanup()
  })

  it('should handle async store updates with proper act wrapper', async () => {
    const [store, update] = createStore({ count: 0 })

    function Counter() {
      useSignals()
      return <div data-testid="count">{store.count}</div>
    }

    render(<Counter />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    // Update with proper async act wrapper
    await act(async () => {
      update({ $set: { count: 10 } })
      // Flush microtasks to ensure effect runs
      await Promise.resolve()
    })

    expect(screen.getByTestId('count').textContent).toBe('10')
  })

  it('should work with waitFor for async updates', async () => {
    const [store, update] = createStore({ message: 'hello' })

    function Display() {
      useSignals()
      return <div data-testid="message">{store.message}</div>
    }

    render(<Display />)
    expect(screen.getByTestId('message').textContent).toBe('hello')

    // Update the store
    update({ $set: { message: 'world' } })

    // Use waitFor to wait for the update to propagate
    await waitFor(() => {
      expect(screen.getByTestId('message').textContent).toBe('world')
    })
  })

  it('should test multiple rapid updates with batching', async () => {
    const [store, update] = createStore({ counter: 0 })
    let renderCount = 0

    function Counter() {
      useSignals()
      renderCount++
      return (
        <div>
          <div data-testid="counter">{store.counter}</div>
          <div data-testid="renders">{renderCount}</div>
        </div>
      )
    }

    render(<Counter />)
    expect(screen.getByTestId('counter').textContent).toBe('0')
    expect(renderCount).toBe(1)

    // Perform multiple updates in a single act
    await act(async () => {
      update({ $set: { counter: 1 } })
      update({ $set: { counter: 2 } })
      update({ $set: { counter: 3 } })
      update({ $set: { counter: 4 } })
      update({ $set: { counter: 5 } })
      // Flush microtasks
      await Promise.resolve()
    })

    // Should show final value
    expect(screen.getByTestId('counter').textContent).toBe('5')
    // Should only re-render once due to batching
    expect(renderCount).toBe(2)
  })

  it('should verify useStore convenience hook works with async', async () => {
    const [store, update] = createStore({ value: 100 })

    function Display() {
      const state = useStore(store)
      return <div data-testid="value">{state.value}</div>
    }

    render(<Display />)
    expect(screen.getByTestId('value').textContent).toBe('100')

    await act(async () => {
      update({ $set: { value: 200 } })
      await Promise.resolve()
    })

    expect(screen.getByTestId('value').textContent).toBe('200')
  })

  it('should handle nested updates with async', async () => {
    const [store, update] = createStore({
      user: {
        name: 'Alice',
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
    })

    function UserSettings() {
      useSignals()
      return (
        <div>
          <div data-testid="theme">{store.user.settings.theme}</div>
          <div data-testid="name">{store.user.name}</div>
        </div>
      )
    }

    render(<UserSettings />)
    expect(screen.getByTestId('theme').textContent).toBe('dark')
    expect(screen.getByTestId('name').textContent).toBe('Alice')

    await act(async () => {
      update({ $set: { 'user.settings.theme': 'light' } })
      await Promise.resolve()
    })

    expect(screen.getByTestId('theme').textContent).toBe('light')
    expect(screen.getByTestId('name').textContent).toBe('Alice')
  })

  it('should test array operations with async updates', async () => {
    const [store, update] = createStore({
      todos: [
        { id: 1, text: 'First', done: false },
        { id: 2, text: 'Second', done: false },
      ],
    })

    function TodoList() {
      useSignals()
      return (
        <ul data-testid="list">
          {store.todos.map(todo => (
            <li key={todo.id} data-testid={`todo-${todo.id}`}>
              {todo.text} - {todo.done ? 'done' : 'pending'}
            </li>
          ))}
        </ul>
      )
    }

    render(<TodoList />)
    const list = screen.getByTestId('list')
    expect(list.children.length).toBe(2)

    // Add a new todo
    await act(async () => {
      update({
        $push: {
          todos: { id: 3, text: 'Third', done: false },
        },
      })
      await Promise.resolve()
    })

    expect(list.children.length).toBe(3)
    expect(screen.getByTestId('todo-3').textContent).toBe('Third - pending')

    // Update a specific todo
    await act(async () => {
      update({
        $set: {
          'todos.1.done': true,
        },
      })
      await Promise.resolve()
    })

    expect(screen.getByTestId('todo-2').textContent).toBe('Second - done')
  })

  it('should handle conditional rendering with async updates', async () => {
    const [store, update] = createStore({
      isVisible: true,
      content: 'Hello World',
    })

    function ConditionalComponent() {
      useSignals()
      return (
        <div>
          {store.isVisible && <div data-testid="content">{store.content}</div>}
        </div>
      )
    }

    render(<ConditionalComponent />)
    expect(screen.getByTestId('content').textContent).toBe('Hello World')

    // Hide the content
    await act(async () => {
      update({ $set: { isVisible: false } })
      await Promise.resolve()
    })

    expect(screen.queryByTestId('content')).toBeNull()

    // Show with updated content
    await act(async () => {
      update({
        $set: {
          isVisible: true,
          content: 'Updated Content',
        },
      })
      await Promise.resolve()
    })

    expect(screen.getByTestId('content').textContent).toBe('Updated Content')
  })

  it('should test fine-grained reactivity with multiple components', async () => {
    const [store, update] = createStore({
      firstName: 'John',
      lastName: 'Doe',
      age: 30,
    })

    let firstNameRenders = 0
    let lastNameRenders = 0
    let ageRenders = 0

    function FirstName() {
      useSignals()
      firstNameRenders++
      return <div data-testid="firstName">{store.firstName}</div>
    }

    function LastName() {
      useSignals()
      lastNameRenders++
      return <div data-testid="lastName">{store.lastName}</div>
    }

    function Age() {
      useSignals()
      ageRenders++
      return <div data-testid="age">{store.age}</div>
    }

    render(
      <>
        <FirstName />
        <LastName />
        <Age />
      </>
    )

    expect(firstNameRenders).toBe(1)
    expect(lastNameRenders).toBe(1)
    expect(ageRenders).toBe(1)

    // Update only age
    await act(async () => {
      update({ $set: { age: 31 } })
      await Promise.resolve()
    })

    // Only Age component should re-render
    expect(firstNameRenders).toBe(1)
    expect(lastNameRenders).toBe(1)
    expect(ageRenders).toBe(2)
    expect(screen.getByTestId('age').textContent).toBe('31')

    // Update firstName
    await act(async () => {
      update({ $set: { firstName: 'Jane' } })
      await Promise.resolve()
    })

    expect(firstNameRenders).toBe(2)
    expect(lastNameRenders).toBe(1)
    expect(ageRenders).toBe(2)
    expect(screen.getByTestId('firstName').textContent).toBe('Jane')
  })
})
