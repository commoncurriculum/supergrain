import { describe, it, expect, vi } from "vitest";

import { createStore, effect } from "../../src";

describe("Array mutation methods trigger reactivity", () => {
  it("push() triggers effect tracking length", () => {
    const [store] = createStore({ items: [1, 2, 3] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(3);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.push(4);
    expect(capturedLength).toBe(4);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("push() with multiple items triggers effect", () => {
    const [store] = createStore({ items: [1] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.push(2, 3, 4);
    expect(capturedLength).toBe(4);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("splice() removing an element triggers effect", () => {
    const [store] = createStore({ items: [1, 2, 3] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(3);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.splice(1, 1);
    expect(capturedLength).toBe(2);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("splice() removing the last element triggers effect", () => {
    const [store] = createStore({ items: [1, 2, 3] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(3);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.splice(2, 1);
    expect(capturedLength).toBe(2);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("pop() triggers effect", () => {
    const [store] = createStore({ items: [1, 2, 3] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(3);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.pop();
    expect(capturedLength).toBe(2);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("shift() triggers effect", () => {
    const [store] = createStore({ items: [1, 2, 3] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(3);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.shift();
    expect(capturedLength).toBe(2);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("unshift() triggers effect", () => {
    const [store] = createStore({ items: [1, 2, 3] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(3);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.unshift(0);
    expect(capturedLength).toBe(4);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("push() on initially empty array triggers effect", () => {
    const [store] = createStore<{ items: number[] }>({ items: [] });

    let capturedLength = 0;
    const effectFn = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(effectFn);
    expect(capturedLength).toBe(0);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.push(1);
    expect(capturedLength).toBe(1);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("push() triggers effect tracking iteration", () => {
    const [store] = createStore({ items: [{ id: 1, label: "a" }] });

    let labels: string[] = [];
    const effectFn = vi.fn(() => {
      labels = [];
      for (const item of store.items) {
        labels.push(item.label);
      }
    });

    effect(effectFn);
    expect(labels).toEqual(["a"]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.push({ id: 2, label: "b" });
    expect(labels).toEqual(["a", "b"]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("splice() triggers effect tracking iteration", () => {
    const [store] = createStore({
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ],
    });

    let labels: string[] = [];
    const effectFn = vi.fn(() => {
      labels = [];
      for (const item of store.items) {
        labels.push(item.label);
      }
    });

    effect(effectFn);
    expect(labels).toEqual(["a", "b", "c"]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.splice(1, 1);
    expect(labels).toEqual(["a", "c"]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });
});
