import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createGrain,
  effect,
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
} from "../../src";
import { startBatch, endBatch } from "../../src/internal";

describe("Array mutation methods trigger reactivity", () => {
  beforeEach(() => {
    enableProfiling();
    resetProfiler();
  });

  afterEach(() => {
    disableProfiling();
  });
  it("push() triggers effect tracking length", () => {
    const store = createGrain({ items: [1, 2, 3] });

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
    const store = createGrain({ items: [1] });

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
    const store = createGrain({ items: [1, 2, 3] });

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
    const store = createGrain({ items: [1, 2, 3] });

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
    const store = createGrain({ items: [1, 2, 3] });

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
    const store = createGrain({ items: [1, 2, 3] });

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
    const store = createGrain({ items: [1, 2, 3] });

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
    const store = createGrain<{ items: number[] }>({ items: [] });

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
    const store = createGrain({ items: [{ id: 1, label: "a" }] });

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

  it("sort() triggers effect", () => {
    const store = createGrain({ items: [3, 1, 2] });

    let captured: number[] = [];
    const effectFn = vi.fn(() => {
      captured = [...store.items];
    });

    effect(effectFn);
    expect(captured).toEqual([3, 1, 2]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.sort();
    expect(captured).toEqual([1, 2, 3]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("reverse() triggers effect", () => {
    const store = createGrain({ items: [1, 2, 3] });

    let captured: number[] = [];
    const effectFn = vi.fn(() => {
      captured = [...store.items];
    });

    effect(effectFn);
    expect(captured).toEqual([1, 2, 3]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.reverse();
    expect(captured).toEqual([3, 2, 1]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("fill() triggers effect", () => {
    const store = createGrain({ items: [1, 2, 3] });

    let captured: number[] = [];
    const effectFn = vi.fn(() => {
      captured = [...store.items];
    });

    effect(effectFn);
    expect(captured).toEqual([1, 2, 3]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.fill(0);
    expect(captured).toEqual([0, 0, 0]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("copyWithin() triggers effect", () => {
    const store = createGrain({ items: [1, 2, 3, 4, 5] });

    let captured: number[] = [];
    const effectFn = vi.fn(() => {
      captured = [...store.items];
    });

    effect(effectFn);
    expect(captured).toEqual([1, 2, 3, 4, 5]);
    expect(effectFn).toHaveBeenCalledTimes(1);

    store.items.copyWithin(0, 3);
    expect(captured).toEqual([4, 5, 3, 4, 5]);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("splice() triggers effect tracking iteration", () => {
    const store = createGrain({
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

  it("index swap does not fire version-only effect (no structural change)", () => {
    const store = createGrain({
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ],
    });

    // This effect only tracks the array's version signal (via .length),
    // NOT per-element signals. A swap doesn't change length/structure,
    // so this should NOT fire.
    let capturedLength = 0;
    const versionEffect = vi.fn(() => {
      capturedLength = store.items.length;
    });

    effect(versionEffect);
    expect(capturedLength).toBe(3);
    expect(versionEffect).toHaveBeenCalledTimes(1);

    // Swap indices 0 and 2 (batched, like a real swap operation)
    startBatch();
    const tmp = store.items[0]!;
    store.items[0] = store.items[2]!;
    store.items[2] = tmp;
    endBatch();

    // Length didn't change, so version-only effect should NOT re-fire
    expect(capturedLength).toBe(3);
    expect(versionEffect).toHaveBeenCalledTimes(1);
  });

  it("index swap fires per-element effects only for swapped indices", () => {
    const store = createGrain({
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ],
    });

    // Effect tracking only index 0
    let item0Label = "";
    const effect0 = vi.fn(() => {
      item0Label = store.items[0]!.label;
    });

    // Effect tracking only index 1 (untouched by swap)
    let item1Label = "";
    const effect1 = vi.fn(() => {
      item1Label = store.items[1]!.label;
    });

    // Effect tracking only index 2
    let item2Label = "";
    const effect2 = vi.fn(() => {
      item2Label = store.items[2]!.label;
    });

    effect(effect0);
    effect(effect1);
    effect(effect2);

    expect(effect0).toHaveBeenCalledTimes(1);
    expect(effect1).toHaveBeenCalledTimes(1);
    expect(effect2).toHaveBeenCalledTimes(1);

    // Swap indices 0 and 2 (batched)
    startBatch();
    const tmp = store.items[0]!;
    store.items[0] = store.items[2]!;
    store.items[2] = tmp;
    endBatch();

    // Effects for swapped indices should fire
    expect(item0Label).toBe("c");
    expect(effect0).toHaveBeenCalledTimes(2);
    expect(item2Label).toBe("a");
    expect(effect2).toHaveBeenCalledTimes(2);

    // Effect for untouched index should NOT fire
    expect(item1Label).toBe("b");
    expect(effect1).toHaveBeenCalledTimes(1);

    const p = getProfile();
    expect(p.signalWrites).toBe(2); // 2 index assignments
  });

  it("iteration effect re-fires on swap (sees new element order)", () => {
    const store = createGrain({
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
        { id: 3, label: "c" },
      ],
    });

    let labels: string[] = [];
    const iterEffect = vi.fn(() => {
      labels = [];
      for (const item of store.items) {
        labels.push(item.label);
      }
    });

    effect(iterEffect);
    expect(labels).toEqual(["a", "b", "c"]);
    expect(iterEffect).toHaveBeenCalledTimes(1);

    // Swap indices 0 and 2 (batched)
    startBatch();
    const tmp = store.items[0]!;
    store.items[0] = store.items[2]!;
    store.items[2] = tmp;
    endBatch();

    // Iteration effect should see new order
    expect(labels).toEqual(["c", "b", "a"]);
    expect(iterEffect).toHaveBeenCalledTimes(2);

    const p = getProfile();
    expect(p.signalWrites).toBe(2); // 2 index assignments
  });
});
