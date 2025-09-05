import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createStore, effect } from '../src'

describe('Array Support', () => {
  let store: any
  let setStore: any

  beforeEach(() => {
    const posts = [
      { id: 1, title: 'Post 1' },
      { id: 2, title: 'Post 2' },
    ]
    ;[store, setStore] = createStore({ posts: { all: { items: posts } } })
  })

  it('should track access to array elements by index', () => {
    let postTitle = ''
    const titleEffect = vi.fn(() => {
      postTitle = store.posts.all.items[0].title
    })

    effect(titleEffect)

    expect(postTitle).toBe('Post 1')
    expect(titleEffect).toHaveBeenCalledTimes(1)

    // Update the title
    setStore('posts', 'all', 'items', 0, 'title', 'Updated Post 1')
    expect(postTitle).toBe('Updated Post 1')
    expect(titleEffect).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using push', () => {
    let postsLength = 0
    const lengthEffect = vi.fn(() => {
      postsLength = store.posts.all.items.length
    })

    effect(lengthEffect)

    expect(postsLength).toBe(2)
    expect(lengthEffect).toHaveBeenCalledTimes(1)

    store.posts.all.items.push({ id: 3, title: 'Post 3' })

    expect(postsLength).toBe(3)
    expect(lengthEffect).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using splice', () => {
    let postsLength = 0
    const lengthEffect = vi.fn(() => {
      postsLength = store.posts.all.items.length
    })

    effect(lengthEffect)

    expect(postsLength).toBe(2)
    expect(lengthEffect).toHaveBeenCalledTimes(1)

    store.posts.all.items.splice(0, 1) // Remove the first item

    expect(postsLength).toBe(1)
    expect(lengthEffect).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using sort', () => {
    const items = [
      { id: 2, title: 'B' },
      { id: 1, title: 'A' },
    ]
    ;[store, setStore] = createStore({ posts: { all: { items } } })

    let firstItemTitle = ''
    const effectFn = vi.fn(() => {
      firstItemTitle = store.posts.all.items[0].title
    })

    effect(effectFn)

    expect(firstItemTitle).toBe('B')
    expect(effectFn).toHaveBeenCalledTimes(1)

    store.posts.all.items.sort((a: any, b: any) =>
      a.title.localeCompare(b.title)
    )

    expect(firstItemTitle).toBe('A')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should be reactive when using reverse', () => {
    let firstItemTitle = ''
    const effectFn = vi.fn(() => {
      firstItemTitle = store.posts.all.items[0].title
    })

    effect(effectFn)

    expect(firstItemTitle).toBe('Post 1')
    expect(effectFn).toHaveBeenCalledTimes(1)

    store.posts.all.items.reverse()

    expect(firstItemTitle).toBe('Post 2')
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should track dependencies inside forEach', () => {
    let titleLengthSum = 0
    const effectFn = vi.fn(() => {
      titleLengthSum = 0
      store.posts.all.items.forEach((post: any) => {
        titleLengthSum += post.title.length
      })
    })

    effect(effectFn)

    expect(titleLengthSum).toBe(12) // "Post 1".length + "Post 2".length = 6 + 6
    expect(effectFn).toHaveBeenCalledTimes(1)

    setStore('posts', 'all', 'items', 0, 'title', 'A')

    expect(titleLengthSum).toBe(7) // "A".length + "Post 2".length = 1 + 6
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should track dependencies inside filter', () => {
    let filtered: any[] = []
    const effectFn = vi.fn(() => {
      filtered = store.posts.all.items.filter((post: any) =>
        post.title.includes('1')
      )
    })

    effect(effectFn)

    expect(filtered).toHaveLength(1)
    expect(filtered[0].title).toBe('Post 1')
    expect(effectFn).toHaveBeenCalledTimes(1)

    setStore('posts', 'all', 'items', 1, 'title', 'Post 1 Again')
    expect(filtered).toHaveLength(2)
    expect(effectFn).toHaveBeenCalledTimes(2)

    setStore('posts', 'all', 'items', 0, 'title', 'Post X')
    expect(filtered).toHaveLength(1)
    expect(filtered[0].title).toBe('Post 1 Again')
    expect(effectFn).toHaveBeenCalledTimes(3)
  })

  it('should track dependencies inside map', () => {
    let titles: string[] = []
    const effectFn = vi.fn(() => {
      titles = store.posts.all.items.map((post: any) => post.title)
    })

    effect(effectFn)

    expect(titles).toEqual(['Post 1', 'Post 2'])
    expect(effectFn).toHaveBeenCalledTimes(1)

    setStore('posts', 'all', 'items', 0, 'title', 'Updated Post')
    expect(titles).toEqual(['Updated Post', 'Post 2'])
    expect(effectFn).toHaveBeenCalledTimes(2)
  })

  it('should not trigger value effects when length changes', () => {
    let postTitle = ''
    const titleEffect = vi.fn(() => {
      postTitle = store.posts.all.items[0].title
    })

    effect(titleEffect)

    expect(postTitle).toBe('Post 1')
    expect(titleEffect).toHaveBeenCalledTimes(1)

    // Add a new item. This should not re-run the effect above.
    store.posts.all.items.push({ id: 3, title: 'Post 3' })

    expect(postTitle).toBe('Post 1') // Should still be the same
    expect(titleEffect).toHaveBeenCalledTimes(1) // Should NOT have been called again
  })

  it('should handle array replacement efficiently', () => {
    let accessCount = 0
    const effectFn = vi.fn(() => {
      accessCount = 0
      store.posts.all.items.forEach((post: any) => {
        accessCount++
        post.title // access title
      })
    })

    effect(effectFn)
    expect(accessCount).toBe(2)
    expect(effectFn).toHaveBeenCalledTimes(1)

    // Replace entire array
    const newItems = [
      { id: 3, title: 'New Post 1' },
      { id: 4, title: 'New Post 2' },
      { id: 5, title: 'New Post 3' },
    ]
    setStore('posts', 'all', 'items', newItems)

    expect(accessCount).toBe(3)
    expect(effectFn).toHaveBeenCalledTimes(2)
  })
})
