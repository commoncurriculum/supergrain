// =============================================================================
// internal-contract.test.ts
// =============================================================================
//
// Pins behaviors that intentionally reach into the kernel's internal symbol
// surface ($RAW / $PROXY / $NODE / $VERSION) and its non-exported helpers
// (bumpVersion, deleteProperty). Anything in this file is testing the
// *internal* contract — change here means a deliberate change to internals.
//
// User-facing tests should NOT import from `../../src/internal` or assert
// on these symbols. If you find yourself reaching for $RAW or $VERSION
// outside this file, you're testing the wrong layer.
// =============================================================================
import { describe, it, expect } from "vitest";

import { createReactive, effect } from "../../src";
import { $NODE, $PROXY, $RAW, $VERSION, bumpVersion, deleteProperty } from "../../src/internal";

describe("internal symbol exposure", () => {
  it("plain object proxies answer `in` for every internal symbol", () => {
    const state = createReactive({ a: 1 });
    expect($RAW in state).toBe(true);
    expect($PROXY in state).toBe(true);
    expect($NODE in state).toBe(true);
    expect($VERSION in state).toBe(true);
  });

  it("[$PROXY] resolves back to the proxy itself (idempotent self-reference)", () => {
    const state = createReactive({ a: 1 });
    expect((state as typeof state & { [$PROXY]: typeof state })[$PROXY]).toBe(state);
  });
});

describe("internal helpers — direct invocation", () => {
  it("bumpVersion is a no-op (does not throw) when the version signal hasn't been read yet", () => {
    // Used by the kernel's write path before any subscriber has touched
    // $VERSION. Must lazy-create + bump without crashing.
    const target = {};
    expect(() => bumpVersion(target)).not.toThrow();
  });

  it("deleteProperty leaves array length stable when removing an interior index", () => {
    // The low-level helper differs from `proxy.splice(...)` — it deletes the
    // index in place and leaves a sparse hole. Pinning so callers don't
    // accidentally grow a dependency on length compaction.
    const items = [1, 2, 3];
    deleteProperty(items, 1);
    expect(items).toEqual([1, undefined, 3]);
    expect(items.length).toBe(3);
  });

  it("[$VERSION] read changes after every reactive write, even before tracking", () => {
    // The version signal's value is fed by a process-wide counter; the
    // specific numbers aren't meaningful — only that each write produces a
    // fresh value so `Object.is`-based signal propagation notifies
    // subscribers.
    const state = createReactive<{ a: number; b?: number }>({ a: 1 }) as {
      a: number;
      b?: number;
    } & {
      [$VERSION]: unknown;
    };

    const v0 = state[$VERSION];
    state.b = 2;
    const v1 = state[$VERSION];
    expect(v1).not.toBe(v0);

    state.a = 3;
    const v2 = state[$VERSION];
    expect(v2).not.toBe(v1);
  });

  it("array property reads succeed before the array's $VERSION signal exists", () => {
    // Defensive read path: pulling an array property must work whether or
    // not anything has yet subscribed to its version.
    const state = createReactive({ items: [1, 2] });
    let snapshot: Array<number> = [];

    effect(() => {
      snapshot = [...state.items];
    });

    expect(snapshot).toEqual([1, 2]);
  });
});
