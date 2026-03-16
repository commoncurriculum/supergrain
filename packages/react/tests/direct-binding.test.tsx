import { describe, it, expect, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { useRef } from 'react'
import { createStore } from '@supergrain/core'
import { useDirectBindings } from '../src'

afterEach(cleanup)

describe('useDirectBindings', () => {
  it('updates textContent directly when signal changes', async () => {
    const [store] = createStore({ label: 'hello' })

    function TestComponent() {
      const ref = useRef<HTMLSpanElement>(null)
      useDirectBindings([
        { ref, getter: () => store.label },
      ])
      return <span ref={ref} data-testid="label">{store.label}</span>
    }

    render(<TestComponent />)
    const el = document.querySelector('[data-testid="label"]')!
    expect(el.textContent).toBe('hello')

    await act(async () => {
      store.label = 'world'
    })

    expect(el.textContent).toBe('world')
  })

  it('updates a DOM attribute directly when signal changes', async () => {
    const [store] = createStore({ selected: false })

    function TestComponent() {
      const ref = useRef<HTMLDivElement>(null)
      useDirectBindings([
        { ref, getter: () => store.selected ? 'active' : '', attr: 'className' },
      ])
      return <div ref={ref} data-testid="box" className={store.selected ? 'active' : ''} />
    }

    render(<TestComponent />)
    const el = document.querySelector('[data-testid="box"]')!
    expect(el.className).toBe('')

    await act(async () => {
      store.selected = true as any
    })

    expect(el.className).toBe('active')
  })

  it('supports multiple bindings on different elements', async () => {
    const [store] = createStore({ name: 'Alice', age: 30 })

    function TestComponent() {
      const nameRef = useRef<HTMLSpanElement>(null)
      const ageRef = useRef<HTMLSpanElement>(null)
      useDirectBindings([
        { ref: nameRef, getter: () => store.name },
        { ref: ageRef, getter: () => store.age },
      ])
      return (
        <div>
          <span ref={nameRef} data-testid="name">{store.name}</span>
          <span ref={ageRef} data-testid="age">{store.age}</span>
        </div>
      )
    }

    render(<TestComponent />)
    const nameEl = document.querySelector('[data-testid="name"]')!
    const ageEl = document.querySelector('[data-testid="age"]')!
    expect(nameEl.textContent).toBe('Alice')
    expect(ageEl.textContent).toBe('30')

    await act(async () => {
      store.name = 'Bob'
    })

    expect(nameEl.textContent).toBe('Bob')
    expect(ageEl.textContent).toBe('30')

    await act(async () => {
      store.age = 31 as any
    })

    expect(nameEl.textContent).toBe('Bob')
    expect(ageEl.textContent).toBe('31')
  })

  it('does not cause React re-renders on signal changes', async () => {
    const [store] = createStore({ label: 'hello' })
    let renderCount = 0

    function TestComponent() {
      renderCount++
      const ref = useRef<HTMLSpanElement>(null)
      useDirectBindings([
        { ref, getter: () => store.label },
      ])
      return <span ref={ref}>{store.label}</span>
    }

    render(<TestComponent />)
    expect(renderCount).toBe(1)

    await act(async () => {
      store.label = 'world'
    })

    // Direct bindings bypass React — render count should NOT increase
    expect(renderCount).toBe(1)
  })

  it('cleans up effects on unmount', async () => {
    const [store] = createStore({ label: 'hello' })

    function TestComponent() {
      const ref = useRef<HTMLSpanElement>(null)
      useDirectBindings([
        { ref, getter: () => store.label },
      ])
      return <span ref={ref}>{store.label}</span>
    }

    const { unmount } = render(<TestComponent />)
    unmount()

    // Should not throw after unmount
    await act(async () => {
      store.label = 'world'
    })
  })

  it('works with computed expressions', async () => {
    const [store] = createStore({ firstName: 'John', lastName: 'Doe' })

    function TestComponent() {
      const ref = useRef<HTMLSpanElement>(null)
      useDirectBindings([
        { ref, getter: () => `${store.firstName} ${store.lastName}` },
      ])
      return <span ref={ref} data-testid="full">{`${store.firstName} ${store.lastName}`}</span>
    }

    render(<TestComponent />)
    const el = document.querySelector('[data-testid="full"]')!
    expect(el.textContent).toBe('John Doe')

    await act(async () => {
      store.firstName = 'Jane'
    })

    expect(el.textContent).toBe('Jane Doe')
  })
})
