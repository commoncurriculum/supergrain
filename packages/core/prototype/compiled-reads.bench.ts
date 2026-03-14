/**
 * Simulates what the Vite plugin would produce:
 * direct signal reads vs proxy reads.
 *
 * Instead of going through a proxy trap, the "compiled" path
 * reads from the signal map directly — exactly what the plugin
 * would rewrite store.title into.
 */

import { bench, describe } from 'vitest'
import { type } from 'arktype'
import { model, effect } from './model'
import { createStore } from '../src'
import { effect as alienEffect, signal as rawSignal } from 'alien-signals'

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

const $SIGNALS = Symbol.for('supergrain:signals')

const data = () => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
  comments: [{ id: 1, text: 'Get 2%', author: 'Scott' }],
})

// --- Non-reactive leaf reads ---

describe('Non-reactive Leaf Reads (100k)', () => {
  // "Compiled" — what the plugin would emit: direct signal call
  const [mStore] = Todo.create(data())
  const signals = (mStore as any)[$SIGNALS]

  bench('compiled (direct signal read)', () => {
    const sig = signals.title
    for (let i = 0; i < 100_000; i++) {
      sig()
    }
  })

  // Raw signal baseline — the absolute ceiling
  const rawSig = rawSignal('Buy milk')
  bench('raw signal baseline', () => {
    for (let i = 0; i < 100_000; i++) {
      rawSig()
    }
  })

  // Current proxy approach
  const [sStore] = createStore(data())
  bench('createStore (proxy)', () => {
    for (let i = 0; i < 100_000; i++) {
      sStore.title
    }
  })

  // Model proxy (no plugin)
  bench('model (proxy, no plugin)', () => {
    for (let i = 0; i < 100_000; i++) {
      mStore.title
    }
  })
})

// --- Non-reactive nested reads ---

describe('Non-reactive Nested Reads (100k)', () => {
  const [mStore] = Todo.create(data())
  const signals = (mStore as any)[$SIGNALS]

  // "Compiled" — plugin flattens store.assignee.name to signals['assignee.name']()
  bench('compiled (direct signal read)', () => {
    const sig = signals['assignee.name']
    for (let i = 0; i < 100_000; i++) {
      sig()
    }
  })

  const rawSig = rawSignal('Scott')
  bench('raw signal baseline', () => {
    for (let i = 0; i < 100_000; i++) {
      rawSig()
    }
  })

  const [sStore] = createStore(data())
  bench('createStore (proxy)', () => {
    for (let i = 0; i < 100_000; i++) {
      sStore.assignee.name
    }
  })

  bench('model (proxy, no plugin)', () => {
    for (let i = 0; i < 100_000; i++) {
      mStore.assignee.name
    }
  })
})

// --- Reactive leaf reads ---

describe('Reactive Leaf Reads (100k inside effect)', () => {
  const [mStore] = Todo.create(data())
  const signals = (mStore as any)[$SIGNALS]

  bench('compiled (direct signal read)', () => {
    const sig = signals.title
    const dispose = alienEffect(() => {
      for (let i = 0; i < 100_000; i++) {
        sig()
      }
    })
    dispose()
  })

  bench('raw signal baseline', () => {
    const sig = rawSignal('Buy milk')
    const dispose = alienEffect(() => {
      for (let i = 0; i < 100_000; i++) {
        sig()
      }
    })
    dispose()
  })

  const [sStore] = createStore(data())
  bench('createStore (proxy)', () => {
    const dispose = alienEffect(() => {
      for (let i = 0; i < 100_000; i++) {
        sStore.title
      }
    })
    dispose()
  })
})

// --- Reactive updates ---

describe('Reactive Updates (1000 $set)', () => {
  bench('model', () => {
    const [store, update] = Todo.create(data())
    const dispose = effect(() => { store.title })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('createStore', () => {
    const [store, update] = createStore(data())
    const dispose = alienEffect(() => { store.title })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })
})
