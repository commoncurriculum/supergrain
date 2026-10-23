import { describe, expect, it, vi } from "vitest";

import { createReactive, effect, stableComputed } from "../../src";

// =============================================================================
// stableComputed(getter)
//
// A plain computed returning `xs.filter().map()` hands back a fresh array on
// every re-run. `stableComputed` keeps ONE reactive array, reconciled in
// place, so: the reference is stable across recomputes, reads are fine-grained
// (only changed slots notify), and it still firewalls (an equal re-run doesn't
// propagate). These tests pin all three.
// =============================================================================

describe("stableComputed", () => {
  it("returns the same array reference across recomputes (membership changes)", () => {
    const src = createReactive<{ items: Array<{ id: number }> }>({ items: [{ id: 1 }] });
    const evens = stableComputed(() => src.items.map((i) => i));

    const first = evens();
    expect(first.map((i) => i.id)).toEqual([1]);

    src.items.push({ id: 2 });
    // A plain computed would hand back a fresh array here; this one does not.
    expect(evens()).toBe(first);
    expect(first.map((i) => i.id)).toEqual([1, 2]);

    src.items.pop();
    expect(evens()).toBe(first);
    expect(first.map((i) => i.id)).toEqual([1]);
  });

  it("is fine-grained: a per-index subscriber fires only for the slot that changed", () => {
    const src = createReactive<{ items: Array<{ id: number; label: string }> }>({
      items: [
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ],
    });
    const view = stableComputed(() => src.items.map((i) => i));

    let seen0 = "";
    let seen1 = "";
    // Read the computed inside the effect (as a real consumer / `get values()`
    // does) so the effect subscribes to it and it reconciles on change.
    const e0 = vi.fn(() => {
      seen0 = view()[0]!.label;
    });
    const e1 = vi.fn(() => {
      seen1 = view()[1]!.label;
    });
    effect(e0);
    effect(e1);
    expect(e0).toHaveBeenCalledTimes(1);
    expect(e1).toHaveBeenCalledTimes(1);

    // Replace slot 0 only.
    src.items[0] = { id: 1, label: "A" };

    expect(seen0).toBe("A");
    expect(e0).toHaveBeenCalledTimes(2);
    // Slot 1 was untouched — its subscriber must not re-run.
    expect(seen1).toBe("b");
    expect(e1).toHaveBeenCalledTimes(1);
  });

  it("firewalls: an iterating subscriber does not re-run when the reconciled result is unchanged", () => {
    // `flag` is read by the getter but does not affect the projected array, so
    // toggling it re-runs the computed to the SAME contents — subscribers of the
    // array must stay quiet.
    const src = createReactive<{ items: Array<number>; flag: boolean }>({
      items: [1, 2],
      flag: false,
    });
    const view = stableComputed(() => {
      void src.flag; // create a dependency that doesn't change the output
      return src.items.map((n) => n);
    });

    const seen: Array<Array<number>> = [];
    effect(() => {
      seen.push([...view()]);
    });
    expect(seen).toEqual([[1, 2]]);

    src.flag = true; // re-runs the getter, same projected contents

    expect(seen).toEqual([[1, 2]]); // no spurious re-fire
  });

  it("re-runs an iterating subscriber when membership actually changes", () => {
    const src = createReactive<{ items: Array<number> }>({ items: [1, 2] });
    const view = stableComputed(() => src.items.map((n) => n));

    const seen: Array<Array<number>> = [];
    effect(() => {
      seen.push([...view()]);
    });
    expect(seen).toEqual([[1, 2]]);

    src.items.push(3);

    expect(seen.at(-1)).toEqual([1, 2, 3]);
  });

  it("reconciles trailing `undefined` elements as own slots, not a shorter array", () => {
    // A projection to an optional field can legitimately END in `undefined`.
    // Those slots compare equal to the shorter target's out-of-bounds reads, so
    // the reconcile must assign them anyway (extending `length` with own slots,
    // never holes — `map`/`forEach` skip holes).
    const src = createReactive<{ items: Array<{ nickname?: string }> }>({
      items: [{ nickname: "ada" }, {}],
    });
    const nicknames = stableComputed(() => src.items.map((i) => i.nickname));

    const value = nicknames();
    expect(value.length).toBe(2);
    expect([...value]).toEqual(["ada", undefined]);
    // Own slot, not a hole: iteration must visit it.
    expect(value.map((n) => n ?? "-")).toEqual(["ada", "-"]);
  });

  it("regrows from a truncated result back to one with a trailing `undefined`", () => {
    const src = createReactive<{ items: Array<number | undefined> }>({ items: [1, undefined] });
    const view = stableComputed(() => src.items.map((n) => n));
    expect([...view()]).toEqual([1, undefined]);

    src.items.length = 1; // shrink: [1]
    expect([...view()]).toEqual([1]);

    src.items.push(undefined); // regrow: [1, undefined]
    expect(view().length).toBe(2);
    expect([...view()]).toEqual([1, undefined]);
  });

  it("throws if the getter returns a non-array", () => {
    const src = createReactive<{ n: number }>({ n: 1 });
    // @ts-expect-error — the signature requires an array-returning getter
    const bad = stableComputed(() => src.n);
    expect(() => bad()).toThrow(/requires the getter to return an array/);
  });
});
