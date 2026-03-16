import { describe, it, expect, vi } from 'vitest'
import { type } from 'arktype'
import { createModelStore, effect } from '../src'

const TodoSchema = type({
  id: 'number',
  title: 'string',
  completed: 'boolean',
  assignee: {
    name: 'string',
    avatar: 'string',
  },
})

describe('createModelStore', () => {
  it('should create a store from an ArkType schema', () => {
    const [_store, _update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    expect(view.title).toBe('Buy milk')
    expect(view.id).toBe(1)
    expect(view.completed).toBe(false)
  })

  it('should return reactive view reads inside effects', () => {
    const [_store, update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    let title = ''
    const effectFn = vi.fn(() => {
      title = view.title
    })

    effect(effectFn)
    expect(title).toBe('Buy milk')
    expect(effectFn).toHaveBeenCalledTimes(1)

    update({ $set: { title: 'Buy eggs' } })
    expect(title).toBe('Buy eggs')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should allow writes through the update function', () => {
    const [_store, update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    expect(view.completed).toBe(false)
    update({ $set: { completed: true } })
    expect(view.completed).toBe(true)
  })

  it('should handle nested object views', () => {
    const [_store, _update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    const assigneeView = view.assignee
    expect(assigneeView.name).toBe('Scott')
    expect(assigneeView.avatar).toBe('scott.png')
  })

  it('should reactively track nested object properties', () => {
    const [_store, update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    let name = ''
    const effectFn = vi.fn(() => {
      name = view.assignee.name
    })

    effect(effectFn)
    expect(name).toBe('Scott')
    expect(effectFn).toHaveBeenCalledTimes(1)

    update({ $set: { 'assignee.name': 'Alice' } })
    expect(name).toBe('Alice')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should handle sub-tree replacement for nested objects', () => {
    const [_store, update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    let name = ''
    const effectFn = vi.fn(() => {
      name = view.assignee.name
    })

    effect(effectFn)
    expect(name).toBe('Scott')

    // Replace the entire assignee sub-tree
    update({ $set: { assignee: { name: 'Bob', avatar: 'bob.png' } } })
    expect(name).toBe('Bob')
    expect(view.assignee.avatar).toBe('bob.png')
  })

  it('should only re-run effects when tracked properties change', () => {
    const [_store, update, view] = createModelStore(TodoSchema, {
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
    })

    let title = ''
    const titleEffect = vi.fn(() => {
      title = view.title
    })

    effect(titleEffect)
    expect(titleEffect).toHaveBeenCalledTimes(1)

    // Updating a different property should not trigger the title effect
    update({ $set: { completed: true } })
    expect(titleEffect).toHaveBeenCalledTimes(1)

    // Updating title should trigger it
    update({ $set: { title: 'Buy eggs' } })
    expect(titleEffect).toHaveBeenCalledTimes(2)
    expect(title).toBe('Buy eggs')
  })

  it('should share view prototype across instances with the same schema', () => {
    const data1 = { id: 1, title: 'A', completed: false, assignee: { name: 'X', avatar: 'x.png' } }
    const data2 = { id: 2, title: 'B', completed: true, assignee: { name: 'Y', avatar: 'y.png' } }

    const [, , view1] = createModelStore(TodoSchema, data1)
    const [, , view2] = createModelStore(TodoSchema, data2)

    // They should share the same prototype (schema-driven, built once)
    expect(Object.getPrototypeOf(view1)).toBe(Object.getPrototypeOf(view2))
  })

  it('should work with a flat schema (no nested objects)', () => {
    const FlatSchema = type({
      x: 'number',
      y: 'number',
      label: 'string',
    })

    const [_store, update, view] = createModelStore(FlatSchema, {
      x: 10,
      y: 20,
      label: 'origin',
    })

    let label = ''
    const effectFn = vi.fn(() => {
      label = view.label
    })

    effect(effectFn)
    expect(label).toBe('origin')

    update({ $set: { label: 'moved' } })
    expect(label).toBe('moved')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })
})
