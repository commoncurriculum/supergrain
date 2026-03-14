import { bench, describe } from 'vitest'
import { type } from 'arktype'
import { model, effect } from './model'
import { createStore } from '../src'
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

const initialData = () => ({
  id: 1,
  title: 'Buy milk',
  completed: false,
  assignee: { name: 'Scott', avatar: 'scott.png' },
  tags: ['grocery'],
  comments: [{ id: 1, text: 'Get 2%', author: 'Scott' }],
})

describe('Store Creation', () => {
  bench('model.create()', () => {
    Todo.create(initialData())
  })

  bench('createStore()', () => {
    createStore(initialData())
  })
})

describe('Non-reactive Leaf Reads (100k)', () => {
  const [mStore] = Todo.create(initialData())
  const [sStore] = createStore(initialData())

  bench('model', () => {
    for (let i = 0; i < 100_000; i++) {
      mStore.title
    }
  })

  bench('createStore', () => {
    for (let i = 0; i < 100_000; i++) {
      sStore.title
    }
  })
})

describe('Non-reactive Nested Reads (100k)', () => {
  const [mStore] = Todo.create(initialData())
  const [sStore] = createStore(initialData())

  bench('model', () => {
    for (let i = 0; i < 100_000; i++) {
      mStore.assignee.name
    }
  })

  bench('createStore', () => {
    for (let i = 0; i < 100_000; i++) {
      sStore.assignee.name
    }
  })
})

describe('Reactive Updates via $set (1000)', () => {
  bench('model', () => {
    const [store, update] = Todo.create(initialData())
    const dispose = effect(() => {
      store.title
    })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })

  bench('createStore', () => {
    const [store, update] = createStore(initialData())
    const dispose = alienEffect(() => {
      store.title
    })
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } })
    }
    dispose()
  })
})

describe('Direct Assignment (1000)', () => {
  bench('model: store.title = x', () => {
    const [store] = Todo.create(initialData())
    const dispose = effect(() => {
      store.title
    })
    for (let i = 0; i < 1000; i++) {
      store.title = `Title ${i}` as any
    }
    dispose()
  })

  bench('createStore: store.title = x', () => {
    const [store] = createStore(initialData())
    const dispose = alienEffect(() => {
      store.title
    })
    for (let i = 0; i < 1000; i++) {
      ;(store as any).title = `Title ${i}`
    }
    dispose()
  })
})

describe('Array Item Reads (100k)', () => {
  const bigData = () => {
    const d = initialData()
    d.comments = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      text: `Comment ${i}`,
      author: 'Author',
    }))
    return d
  }

  const [mStore] = Todo.create(bigData())
  const [sStore] = createStore(bigData())

  bench('model', () => {
    for (let i = 0; i < 100_000; i++) {
      mStore.comments[i % 100].text
    }
  })

  bench('createStore', () => {
    for (let i = 0; i < 100_000; i++) {
      sStore.comments[i % 100].text
    }
  })
})
