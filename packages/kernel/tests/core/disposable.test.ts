import { describe, it, expect } from "vitest";

import { createReactive, effect } from "../../src";
import { makeDisposable } from "../../src/internal";

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

describe("makeDisposable()", () => {
  it("adds a non-enumerable [Symbol.dispose] and returns the same object", () => {
    let disposed = 0;
    const target = { a: 1 };

    const result = makeDisposable(target, () => disposed++);

    expect(result).toBe(target);
    expect(Object.keys(result)).toEqual(["a"]);
    expect(Object.getOwnPropertyDescriptor(result, Symbol.dispose)?.enumerable).toBe(false);
    result[Symbol.dispose]();
    expect(disposed).toBe(1);
  });

  it("leaves a frozen target untouched instead of throwing", () => {
    const target = Object.freeze({ a: 1 });

    const result = makeDisposable(target, () => {});

    expect(result).toBe(target);
    expect(Symbol.dispose in result).toBe(false);
  });
});
