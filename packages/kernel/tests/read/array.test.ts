import { update } from "@supergrain/mill";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  createReactive,
  effect,
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
} from "../../src";

describe("Array Support", () => {
  let store: any;

  beforeEach(() => {
    enableProfiling();
    resetProfiler();
    const posts = [
      { id: 1, title: "Post 1" },
      { id: 2, title: "Post 2" },
    ];
    store = createReactive({ posts: { all: { items: posts } } });
  });

  afterEach(() => {
    disableProfiling();
  });

  it("should track access to array elements by index", () => {
    let postTitle = "";
    const titleEffect = vi.fn(() => {
      postTitle = store.posts.all.items[0]?.title;
    });

    effect(titleEffect);

    expect(postTitle).toBe("Post 1");
    expect(titleEffect).toHaveBeenCalledTimes(1);

    update(store, { $set: { "posts.all.items.0.title": "Updated Post 1" } });
    expect(postTitle).toBe("Updated Post 1");
    expect(titleEffect).toHaveBeenCalledTimes(2);

    const p = getProfile();
    // 5 reads per run (posts, all, items, [0], title) × 2 runs
    expect(p.signalReads).toBe(10);
    expect(p.signalSkips).toBe(0);
    expect(p.signalWrites).toBe(1); // title changed
  });

  it("should be reactive when using $push", () => {
    let postsLength = 0;
    const lengthEffect = vi.fn(() => {
      postsLength = store.posts.all.items.length;
    });

    effect(lengthEffect);

    expect(postsLength).toBe(2);
    expect(lengthEffect).toHaveBeenCalledTimes(1);

    update(store, { $push: { "posts.all.items": { id: 3, title: "Post 3" } } });

    expect(postsLength).toBe(3);
    expect(lengthEffect).toHaveBeenCalledTimes(2);

    const p = getProfile();
    // 4 reads per run (posts, all, items, length) × 2 runs
    expect(p.signalReads).toBe(8);
    expect(p.signalSkips).toBe(0);
    expect(p.signalWrites).toBe(1); // length signal write
  });

  it("should be reactive when using $pull", () => {
    let postsLength = 0;
    const lengthEffect = vi.fn(() => {
      postsLength = store.posts.all.items.length;
    });

    effect(lengthEffect);

    expect(postsLength).toBe(2);
    expect(lengthEffect).toHaveBeenCalledTimes(1);

    update(store, { $pull: { "posts.all.items": { id: 1 } } });

    expect(postsLength).toBe(1);
    expect(store.posts.all.items[0].id).toBe(2);
    expect(lengthEffect).toHaveBeenCalledTimes(2);

    const p = getProfile();
    expect(p.signalReads).toBe(8); // 4 per run × 2 runs
    expect(p.signalSkips).toBe(5); // store.posts.all.items[0].id outside effect
    expect(p.signalWrites).toBe(1); // length signal write from pull
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

    update(store, { $set: { "posts.all.items.0.title": "A" } });

    expect(titleLengthSum).toBe(7); // "A" + "Post 2"
    expect(effectFn).toHaveBeenCalledTimes(2);

    const p = getProfile();
    // Per run: posts(1) + all(1) + items(1) + ownKeys/iterator + [0](1) + title(1) + [1](1) + title(1)
    expect(p.signalReads).toBe(20);
    expect(p.signalSkips).toBe(0);
    expect(p.signalWrites).toBe(1); // one title changed
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

    update(store, { $set: { "posts.all.items.1.title": "Post 1 Again" } });
    expect(filtered).toHaveLength(2);
    expect(effectFn).toHaveBeenCalledTimes(2);

    update(store, { $set: { "posts.all.items.0.title": "Post X" } });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe("Post 1 Again");
    expect(effectFn).toHaveBeenCalledTimes(3);

    const p = getProfile();
    // 3 runs × ~10 reads per run
    expect(p.signalReads).toBe(30);
    expect(p.signalSkips).toBe(2); // filtered[0].title reads outside effect
    expect(p.signalWrites).toBe(2); // 2 title changes
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

    update(store, { $set: { "posts.all.items.0.title": "Updated Post" } });
    expect(titles).toEqual(["Updated Post", "Post 2"]);
    expect(effectFn).toHaveBeenCalledTimes(2);

    const p = getProfile();
    // 2 runs × ~10 reads per run
    expect(p.signalReads).toBe(20);
    expect(p.signalSkips).toBe(0);
    expect(p.signalWrites).toBe(1);
  });

  it("should not trigger item-specific effects when length changes", () => {
    let postTitle = "";
    const titleEffect = vi.fn(() => {
      postTitle = store.posts.all.items[0]?.title;
    });

    effect(titleEffect);
    expect(titleEffect).toHaveBeenCalledTimes(1);

    update(store, { $push: { "posts.all.items": { id: 3, title: "Post 3" } } });

    expect(postTitle).toBe("Post 1");
    expect(titleEffect).toHaveBeenCalledTimes(1);

    const p = getProfile();
    // 1 run: posts(1) + all(1) + items(1) + [0](1) + title(1) = 5
    expect(p.signalReads).toBe(5);
    expect(p.signalSkips).toBe(0);
    expect(p.signalWrites).toBe(0);
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
    update(store, { $set: { "posts.all.items": newItems } });

    expect(accessCount).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(2);

    const p = getProfile();
    // Run 1: 2 items iterated. Run 2: 1 item iterated.
    expect(p.signalReads).toBe(17);
    expect(p.signalSkips).toBe(0);
    expect(p.signalWrites).toBe(1); // items property replaced
  });
});


describe("trackArrayVersion branch coverage", () => {
  it("does not crash when an array has no $VERSION signal (never mutated in tracked context)", () => {
    // Create a reactive array that is read in an effect but never mutated.
    // trackArrayVersion will call getNodes(value) but nodes[$VERSION] is
    // undefined (falsy) because no mutation has happened yet, exercising
    // the `if (arrayNodes[$VERSION])` false branch in read.ts.
    const store = createReactive({ items: [1, 2, 3] as number[] });
    const seen: number[] = [];

    // Read the array inside an effect — this calls trackArrayVersion.
    // No prior mutation has bumped $VERSION, so it doesn't exist yet.
    const stop = effect(() => {
      seen.push(store.items.length);
    });

    expect(seen).toEqual([3]);
    stop();
  });
});
