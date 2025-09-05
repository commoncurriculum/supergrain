import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ReactiveStore } from '../src/store'
import { effect } from '@preact/signals-core'

describe('Array Support', () => {
  let store: ReactiveStore

  beforeEach(() => {
    store = new ReactiveStore()
    const posts = [
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]
    store.set('posts', 'all', { items: posts })
  })

  it('should track access to array elements by index', () => {
    const postsProxy = store.find('posts', 'all')!.value
    let postTitle = ''
    const titleEffect = vi.fn(() => {
      postTitle = postsProxy.items[0].title
    })

    effect(titleEffect)

    expect(postTitle).toBe('Post 1')
    expect(titleEffect).toHaveBeenCalledTimes(1)

    // Update the title
    postsProxy.items[0].title = 'Updated Post 1'
    expect(postTitle).toBe('Updated Post 1')
    expect(titleEffect).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using push', () => {
    const postsProxy = store.find('posts', 'all')!.value
    let postsLength = 0
    const lengthEffect = vi.fn(() => {
      postsLength = postsProxy.items.length
    })

    effect(lengthEffect)

    expect(postsLength).toBe(2)
    expect(lengthEffect).toHaveBeenCalledTimes(1)

    postsProxy.items.push({ id: 3, title: 'Post 3' })

    expect(postsLength).toBe(3)
    expect(lengthEffect).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using splice', () => {
    const postsProxy = store.find('posts', 'all')!.value
    let postsLength = 0
    const lengthEffect = vi.fn(() => {
      postsLength = postsProxy.items.length
    })

    effect(lengthEffect)

    expect(postsLength).toBe(2)
    expect(lengthEffect).toHaveBeenCalledTimes(1)

    postsProxy.items.splice(0, 1) // Remove the first item

    expect(postsLength).toBe(1)
    expect(lengthEffect).toHaveBeenCalledTimes(2)
  })
})
