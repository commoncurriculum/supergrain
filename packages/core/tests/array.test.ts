import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ReactiveStore } from '../src/store'
import { effect } from '../src/isTracking'

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
    const postsProxy = store.find('posts', 'all')!()
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
    const postsProxy = store.find('posts', 'all')!()
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
    const postsProxy = store.find('posts', 'all')!()
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

  it('should be reactive when using sort', () => {
    store.set('posts', 'all', {
      items: [
        { id: 2, title: 'B' },
        { id: 1, title: 'A' },
      ],
    })
    const postsProxy = store.find('posts', 'all')!()
    let firstItemTitle = ''
    const effectFn = vi.fn(() => {
      firstItemTitle = postsProxy.items[0].title
    })

    effect(effectFn)

    expect(firstItemTitle).toBe('B')
    expect(effectFn).toHaveBeenCalledTimes(1)

    postsProxy.items.sort((a, b) => a.title.localeCompare(b.title))

    expect(firstItemTitle).toBe('A')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using reverse', () => {
    const postsProxy = store.find('posts', 'all')!()
    let firstItemTitle = ''
    const effectFn = vi.fn(() => {
      firstItemTitle = postsProxy.items[0].title
    })

    effect(effectFn)

    expect(firstItemTitle).toBe('Post 1')
    expect(effectFn).toHaveBeenCalledTimes(1)

    postsProxy.items.reverse()

    expect(firstItemTitle).toBe('Post 2')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should track dependencies inside forEach', () => {
    const postsProxy = store.find('posts', 'all')!()
    let titleLengthSum = 0
    const effectFn = vi.fn(() => {
      titleLengthSum = 0
      postsProxy.items.forEach(post => {
        titleLengthSum += post.title.length
      })
    })

    effect(effectFn)

    expect(titleLengthSum).toBe(12) // "Post 1".length + "Post 2".length = 6 + 6
    expect(effectFn).toHaveBeenCalledTimes(1)

    postsProxy.items[0].title = 'A'

    expect(titleLengthSum).toBe(7) // "A".length + "Post 2".length = 1 + 6
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should track dependencies inside filter', () => {
    const postsProxy = store.find('posts', 'all')!()
    let filtered: any[] = []
    const effectFn = vi.fn(() => {
      filtered = postsProxy.items.filter(post => post.title.includes('1'))
    })

    effect(effectFn)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].title).toBe('Post 1')
    expect(effectFn).toHaveBeenCalledTimes(1)

    postsProxy.items[1].title = 'Post 1 Again'
    expect(filtered).toHaveLength(2)
    expect(effectFn).toHaveBeenCalledTimes(2)

    postsProxy.items[0].title = 'Post X'
    expect(filtered).toHaveLength(1)
    expect(filtered[0].title).toBe('Post 1 Again')
    expect(effectFn).toHaveBeenCalledTimes(3)
  })

  it('should track dependencies inside map', () => {
    const postsProxy = store.find('posts', 'all')!()
    let titles: string[] = []
    const effectFn = vi.fn(() => {
      titles = postsProxy.items.map(post => post.title)
    })

    effect(effectFn)

    expect(titles).toEqual(['Post 1', 'Post 2'])
    expect(effectFn).toHaveBeenCalledTimes(1)

    postsProxy.items[0].title = 'Updated Post'
    expect(titles).toEqual(['Updated Post', 'Post 2'])
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should not trigger value effects when length changes', () => {
    const postsProxy = store.find('posts', 'all')!()
    let postTitle = ''
    const titleEffect = vi.fn(() => {
      postTitle = postsProxy.items[0].title
    })

    effect(titleEffect)

    expect(postTitle).toBe('Post 1')
    expect(titleEffect).toHaveBeenCalledTimes(1)

    // Add a new item. This should not re-run the effect above.
    postsProxy.items.push({ id: 3, title: 'Post 3' })

    expect(postTitle).toBe('Post 1') // Should still be the same
    expect(titleEffect).toHaveBeenCalledTimes(1) // Should NOT have been called again
  })
})
