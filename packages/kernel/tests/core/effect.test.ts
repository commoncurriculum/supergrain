import { describe, it, expect } from "vitest";

import { createReactive, effect } from "../../src";

describe("effect() — Disposable stop function", () => {
  it("`using` stops the effect at the end of the block", () => {
    const store = createReactive({ count: 0 });
    const seen: Array<number> = [];

    {
      using _stop = effect(() => {
        seen.push(store.count);
      });
      store.count = 1;
    }
    store.count = 2;

    expect(seen).toEqual([0, 1]);
  });

  it("[Symbol.dispose] runs the effect's cleanup, same as calling the stop function", () => {
    const store = createReactive({ count: 0 });
    const cleanups: Array<number> = [];

    const stop = effect(() => {
      const value = store.count;
      return () => cleanups.push(value);
    });
    store.count = 1;
    stop[Symbol.dispose]();
    store.count = 2;

    expect(cleanups).toEqual([0, 1]);
  });

  it("the stop function is still directly callable", () => {
    const store = createReactive({ count: 0 });
    let runs = 0;

    const stop = effect(() => {
      void store.count;
      runs++;
    });
    stop();
    store.count = 1;

    expect(runs).toBe(1);
  });
});
