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

  it("[Symbol.dispose] comes from a shared prototype, not a property on each stop function", () => {
    // One stop function per effect — one per tracked() component — so an own
    // property would cost every one of them a property store.
    const first = effect(() => {});
    const second = effect(() => {});

    expect(Object.getOwnPropertySymbols(first)).not.toContain(Symbol.dispose);
    expect(Object.getPrototypeOf(first)).toBe(Object.getPrototypeOf(second));
    expect(first).toBeInstanceOf(Function);
    first.call(null);
    second[Symbol.dispose]();
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
