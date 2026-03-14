/**
 * This file gets transformed by the Vite plugin before running.
 * It measures direct signal reads (plugin-rewritten) vs proxy reads.
 */

import { type } from 'arktype'
import { model, effect } from '../model'
import { createStore } from '../../src'
import { effect as alienEffect } from 'alien-signals'

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

const data = {
  id: 1,
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
  comments: [{ id: 1, text: 'Get 2%', author: 'Scott' }],
}

function measure(name: string, fn: () => void, iterations = 100) {
  // Warmup
  for (let i = 0; i < 10; i++) fn()

  const times: number[] = []
  for (let iter = 0; iter < iterations; iter++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  const ops = Math.round(1000 / mean)
  console.log(`${name}: median=${median.toFixed(4)}ms mean=${mean.toFixed(4)}ms (~${ops} ops/sec)`)
}

// --- Leaf reads: plugin-rewritten vs proxy ---

const [mStore] = Todo.create({ ...data })
const [sStore] = createStore({ ...data })

measure('model (plugin-rewritten): 100k leaf reads', () => {
  for (let i = 0; i < 100_000; i++) {
    mStore.title
  }
})

measure('createStore (proxy): 100k leaf reads', () => {
  for (let i = 0; i < 100_000; i++) {
    sStore.title
  }
})

// --- Nested reads ---

measure('model (plugin-rewritten): 100k nested reads', () => {
  for (let i = 0; i < 100_000; i++) {
    mStore.assignee.name
  }
})

measure('createStore (proxy): 100k nested reads', () => {
  for (let i = 0; i < 100_000; i++) {
    sStore.assignee.name
  }
})

// --- Reactive reads ---

measure('model (plugin-rewritten): 100k reactive leaf reads', () => {
  const [store] = Todo.create({ ...data })
  const dispose = effect(() => {
    for (let i = 0; i < 100_000; i++) {
      store.title
    }
  })
  dispose()
})

measure('createStore (proxy): 100k reactive leaf reads', () => {
  const [store] = createStore({ ...data })
  const dispose = alienEffect(() => {
    for (let i = 0; i < 100_000; i++) {
      store.title
    }
  })
  dispose()
})

// --- Reactive updates ---

measure('model (plugin-rewritten): 1000 reactive updates', () => {
  const [store, update] = Todo.create({ ...data })
  const dispose = effect(() => {
    store.title
  })
  for (let i = 0; i < 1000; i++) {
    update({ $set: { title: `Title ${i}` } })
  }
  dispose()
})

measure('createStore (proxy): 1000 reactive updates', () => {
  const [store, update] = createStore({ ...data })
  const dispose = alienEffect(() => {
    store.title
  })
  for (let i = 0; i < 1000; i++) {
    update({ $set: { title: `Title ${i}` } })
  }
  dispose()
})

// --- Direct assignment ---

measure('model: 1000 direct assignments (store.title = x)', () => {
  const [store] = Todo.create({ ...data })
  const dispose = effect(() => {
    store.title
  })
  for (let i = 0; i < 1000; i++) {
    store.title = `Title ${i}` as any
  }
  dispose()
})

console.log('\nDone.')
