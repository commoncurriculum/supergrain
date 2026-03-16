import { describe, it, expect, vi } from 'vitest'
import { type } from 'arktype'
import { createStore, effect } from '../src'

const TodoSchema = type({
  id: 'number',
  title: 'string',
  completed: 'boolean',
  assignee: {
    name: 'string',
    avatar: 'string',
  },
})

describe('createStore with schema', () => {
  it('should create a store with view from schema', () => {
    const [_store, _update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    expect(view.title).toBe('Buy milk')
    expect(view.id).toBe(1)
    expect(view.completed).toBe(false)
  })

  it('should return reactive view reads inside effects', () => {
    const [_store, update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    let title = ''
    const effectFn = vi.fn(() => { title = view.title })

    effect(effectFn)
    expect(title).toBe('Buy milk')
    expect(effectFn).toHaveBeenCalledTimes(1)

    update({ $set: { title: 'Buy eggs' } })
    expect(title).toBe('Buy eggs')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should allow writes through the update function', () => {
    const [_store, update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    expect(view.completed).toBe(false)
    update({ $set: { completed: true } })
    expect(view.completed).toBe(true)
  })

  it('should handle nested object views', () => {
    const [_store, _update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    const assigneeView = view.assignee
    expect(assigneeView.name).toBe('Scott')
    expect(assigneeView.avatar).toBe('scott.png')
  })

  it('should reactively track nested object properties', () => {
    const [_store, update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    let name = ''
    const effectFn = vi.fn(() => { name = view.assignee.name })

    effect(effectFn)
    expect(name).toBe('Scott')
    expect(effectFn).toHaveBeenCalledTimes(1)

    update({ $set: { 'assignee.name': 'Alice' } })
    expect(name).toBe('Alice')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle sub-tree replacement for nested objects', () => {
    const [_store, update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    let name = ''
    const effectFn = vi.fn(() => { name = view.assignee.name })

    effect(effectFn)
    expect(name).toBe('Scott')

    update({ $set: { assignee: { name: 'Bob', avatar: 'bob.png' } } })
    expect(name).toBe('Bob')
    expect(view.assignee.avatar).toBe('bob.png')
  })

  it('should only re-run effects when tracked properties change', () => {
    const [_store, update, view] = createStore({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    }, TodoSchema)

    let title = ''
    const titleEffect = vi.fn(() => { title = view.title })

    effect(titleEffect)
    expect(titleEffect).toHaveBeenCalledTimes(1)

    update({ $set: { completed: true } })
    expect(titleEffect).toHaveBeenCalledTimes(1)

    update({ $set: { title: 'Buy eggs' } })
    expect(titleEffect).toHaveBeenCalledTimes(2)
    expect(title).toBe('Buy eggs')
  })

  it('should share view prototype across instances with the same schema', () => {
    const data1 = { id: 1, title: 'A', completed: false, assignee: { name: 'X', avatar: 'x.png' } }
    const data2 = { id: 2, title: 'B', completed: true, assignee: { name: 'Y', avatar: 'y.png' } }

    const [, , view1] = createStore(data1, TodoSchema)
    const [, , view2] = createStore(data2, TodoSchema)

    expect(Object.getPrototypeOf(view1)).toBe(Object.getPrototypeOf(view2))
  })

  it('should work with a flat schema (no nested objects)', () => {
    const FlatSchema = type({
      x: 'number',
      y: 'number',
      label: 'string',
    })

    const [_store, update, view] = createStore({
      x: 10,
      y: 20,
      label: 'origin',
    }, FlatSchema)

    let label = ''
    const effectFn = vi.fn(() => { label = view.label })

    effect(effectFn)
    expect(label).toBe('origin')

    update({ $set: { label: 'moved' } })
    expect(label).toBe('moved')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })
})
