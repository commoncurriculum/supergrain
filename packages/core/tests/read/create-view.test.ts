import { describe, it, expect } from 'vitest'
import { createStore, createView, effect } from '../../src'

describe('createView', () => {
  it('creates a view with getters for all properties', () => {
    const [store] = createStore({ title: 'hello', count: 0 })
    const view = createView(store)
    expect(view.title).toBe('hello')
    expect(view.count).toBe(0)
  })

  it('returns cached view for same store', () => {
    const [store] = createStore({ title: 'hello' })
    const view1 = createView(store)
    const view2 = createView(store)
    expect(view1).toBe(view2)
  })

  it('view reads are reactive inside effect', () => {
    const [store] = createStore({ title: 'hello' })
    const view = createView(store)
    let value = ''
    const dispose = effect(() => {
      value = view.title
    })
    expect(value).toBe('hello')
    store.title = 'world'
    expect(value).toBe('world')
    dispose()
  })

  it('view reflects updates from store mutations', () => {
    const [store, update] = createStore({ count: 0 })
    const view = createView(store)
    expect(view.count).toBe(0)
    update({ $inc: { count: 1 } })
    expect(view.count).toBe(1)
  })

  it('handles nested objects', () => {
    const [store] = createStore({ user: { name: 'Scott' } })
    const view = createView(store)
    // view.user returns the raw user object (not a view)
    expect(view.user.name).toBe('Scott')
  })

  it('handles arrays', () => {
    const [store] = createStore({ items: [1, 2, 3] })
    const view = createView(store)
    expect(view.items).toEqual([1, 2, 3])
  })

  it('behaves like a normal readonly object for enumeration and spread', () => {
    const [store] = createStore({ title: 'hello', count: 0 })
    const view = createView(store)

    expect(Object.keys(view)).toEqual(['title', 'count'])
    expect({ ...view }).toEqual({ title: 'hello', count: 0 })
    expect(JSON.parse(JSON.stringify(view))).toEqual({
      title: 'hello',
      count: 0,
    })
  })

  it('is frozen to enforce the readonly facade contract', () => {
    const [store] = createStore({ title: 'hello' })
    const view = createView(store)

    expect(Object.isFrozen(view)).toBe(true)
  })

  it('rejects direct mutation attempts on the readonly facade', () => {
    const [store] = createStore({ title: 'hello' })
    const view = createView(store)

    expect(() => {
      ;(view as any).title = 'world'
    }).toThrow()
    expect(store.title).toBe('hello')
  })
})
