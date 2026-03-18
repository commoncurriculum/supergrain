import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStore, effect } from "../../src";

describe("Array Support", () => {
  let store: any;
  let update: any;

  beforeEach(() => {
    const posts = [
      { id: 1, title: "Post 1" },
      { id: 2, title: "Post 2" },
    ];
    [store, update] = createStore({ posts: { all: { items: posts } } });
  });

  it("should track access to array elements by index", () => {
    let postTitle = "";
    const titleEffect = vi.fn(() => {
      postTitle = store.posts.all.items[0]?.title;
    });

    effect(titleEffect);

    expect(postTitle).toBe("Post 1");
    expect(titleEffect).toHaveBeenCalledTimes(1);

    update({ $set: { "posts.all.items.0.title": "Updated Post 1" } });
    expect(postTitle).toBe("Updated Post 1");
    expect(titleEffect).toHaveBeenCalledTimes(2);
  });

  it("should be reactive when using $push", () => {
    let postsLength = 0;
    const lengthEffect = vi.fn(() => {
      postsLength = store.posts.all.items.length;
    });

    effect(lengthEffect);

    expect(postsLength).toBe(2);
    expect(lengthEffect).toHaveBeenCalledTimes(1);

    update({ $push: { "posts.all.items": { id: 3, title: "Post 3" } } });

    expect(postsLength).toBe(3);
    expect(lengthEffect).toHaveBeenCalledTimes(2);
  });

  it("should be reactive when using $pull", () => {
    let postsLength = 0;
    const lengthEffect = vi.fn(() => {
      postsLength = store.posts.all.items.length;
    });

    effect(lengthEffect);

    expect(postsLength).toBe(2);
    expect(lengthEffect).toHaveBeenCalledTimes(1);

    update({ $pull: { "posts.all.items": { id: 1 } } });

    expect(postsLength).toBe(1);
    expect(store.posts.all.items[0].id).toBe(2);
    expect(lengthEffect).toHaveBeenCalledTimes(2);
  });

  it("should track dependencies inside loops", () => {
    let titleLengthSum = 0;
    const effectFn = vi.fn(() => {
      titleLengthSum = 0;
      for (const post of store.posts.all.items) {
        titleLengthSum += post.title.length;
      }
    });

    effect(effectFn);

    expect(titleLengthSum).toBe(12); // "Post 1" + "Post 2"
    expect(effectFn).toHaveBeenCalledTimes(1);

    update({ $set: { "posts.all.items.0.title": "A" } });

    expect(titleLengthSum).toBe(7); // "A" + "Post 2"
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("should track dependencies inside filter-like loops", () => {
    let filtered: any[] = [];
    const effectFn = vi.fn(() => {
      filtered = [];
      for (const post of store.posts.all.items) {
        if (post.title.includes("1")) {
          filtered.push(post);
        }
      }
    });

    effect(effectFn);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Post 1");
    expect(effectFn).toHaveBeenCalledTimes(1);

    update({ $set: { "posts.all.items.1.title": "Post 1 Again" } });
    expect(filtered).toHaveLength(2);
    expect(effectFn).toHaveBeenCalledTimes(2);

    update({ $set: { "posts.all.items.0.title": "Post X" } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Post 1 Again");
    expect(effectFn).toHaveBeenCalledTimes(3);
  });

  it("should track dependencies inside map-like loops", () => {
    let titles: string[] = [];
    const effectFn = vi.fn(() => {
      titles = [];
      for (const post of store.posts.all.items) {
        titles.push(post.title);
      }
    });

    effect(effectFn);

    expect(titles).toEqual(["Post 1", "Post 2"]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    update({ $set: { "posts.all.items.0.title": "Updated Post" } });
    expect(titles).toEqual(["Updated Post", "Post 2"]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("should not trigger item-specific effects when length changes", () => {
    let postTitle = "";
    const titleEffect = vi.fn(() => {
      postTitle = store.posts.all.items[0]?.title;
    });

    effect(titleEffect);
    expect(titleEffect).toHaveBeenCalledTimes(1);

    update({ $push: { "posts.all.items": { id: 3, title: "Post 3" } } });

    expect(postTitle).toBe("Post 1");
    expect(titleEffect).toHaveBeenCalledTimes(1);
  });

  it("should handle array replacement with $set", () => {
    let accessCount = 0;
    const effectFn = vi.fn(() => {
      accessCount = 0;
      for (const post of store.posts.all.items) {
        accessCount++;
        post.title;
      }
    });

    effect(effectFn);
    expect(accessCount).toBe(2);
    expect(effectFn).toHaveBeenCalledTimes(1);

    const newItems = [{ id: 3, title: "New Post 1" }];
    update({ $set: { "posts.all.items": newItems } });

    expect(accessCount).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });
});
