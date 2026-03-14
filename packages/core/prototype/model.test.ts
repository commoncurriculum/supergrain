/**
 * Prototype validation — tests that the model approach works correctly,
 * then benchmarks it against the current createStore.
 */

import { describe, it, expect } from 'vitest'
import { model, effect } from './model'
import { createStore } from '../src'
import { effect as alienEffect } from 'alien-signals'

// --- Model definitions ---

import { type } from 'arktype'

const CommentType = type({
  id: 'number',
  text: 'string',
  author: 'string',
})

const Todo = model({
  id: 'number',
  title: 'string',
  completed: 'boolean',
  assignee: {
    name: 'string',
    avatar: 'string',
  },
  tags: 'string[]',
  comments: CommentType.array(),
})

// --- Correctness tests ---

describe('Model: correctness', () => {
  it('creates a store from a model', () => {
    const [store] = Todo.create({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
      tags: ['grocery'],
      comments: [{ id: 1, text: 'Get 2%', author: 'Scott' }],
    })

    expect(store.id).toBe(1)
    expect(store.title).toBe('Buy milk')
    expect(store.completed).toBe(false)
    expect(store.assignee.name).toBe('Scott')
    expect(store.tags).toEqual(['grocery'])
    expect(store.comments[0].text).toBe('Get 2%')
  })

  it('tracks leaf property reads in effects', () => {
    const [store, update] = Todo.create({
      id: 1,
      title: 'Buy milk',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
      tags: [],
      comments: [],
    })

    let observed = ''
    const dispose = effect(() => {
      observed = store.title
    })

    expect(observed).toBe('Buy milk')

    update({ $set: { title: 'Buy eggs' } })

    // Effect should re-run (may need microtask for batching)
    expect(observed).toBe('Buy eggs')
    dispose()
  })

  it('tracks nested property reads in effects', () => {
    const [store, update] = Todo.create({
      id: 1,
      title: 'Test',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
      tags: [],
      comments: [],
    })

    let observed = ''
    const dispose = effect(() => {
      observed = store.assignee.name
    })

    expect(observed).toBe('Scott')

    update({ $set: { 'assignee.name': 'Jo' } })
    expect(observed).toBe('Jo')
    dispose()
  })

  it('supports direct assignment on leaf properties', () => {
    const [store] = Todo.create({
      id: 1,
      title: 'Test',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
      tags: [],
      comments: [],
    })

    let observed = ''
    const dispose = effect(() => {
      observed = store.title
    })

    expect(observed).toBe('Test')

    store.title = 'Updated' as any
    expect(observed).toBe('Updated')
    dispose()
  })

  it('handles array items with their own signal maps', () => {
    const [store, update] = Todo.create({
      id: 1,
      title: 'Test',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
      tags: [],
      comments: [
        { id: 1, text: 'First', author: 'Scott' },
        { id: 2, text: 'Second', author: 'Jo' },
      ],
    })

    expect(store.comments[0].text).toBe('First')
    expect(store.comments[1].author).toBe('Jo')
  })

  it('supports $push for arrays', () => {
    const [store, update] = Todo.create({
      id: 1,
      title: 'Test',
      completed: false,
      assignee: { name: 'Scott', avatar: 'scott.png' },
      tags: [],
      comments: [{ id: 1, text: 'First', author: 'Scott' }],
    })

    update({
      $push: {
        comments: { id: 2, text: 'New comment', author: 'Jo' },
      },
    })

    expect(store.comments.length).toBe(2)
    expect(store.comments[1].text).toBe('New comment')
  })
})

