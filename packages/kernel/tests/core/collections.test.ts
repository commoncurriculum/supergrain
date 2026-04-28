import fc from "fast-check";
import { describe, it, expect, vi } from "vitest";

import { createReactive, effect, unwrap, batch } from "../../src";
import { $PROXY, $RAW } from "../../src/internal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run fn inside an effect, return a cleanup and a way to get call count. */
function tracked<T>(fn: () => T): { latest: () => T; count: () => number; stop: () => void } {
  let latest: T;
  let callCount = 0;
  const stop = effect(() => {
    latest = fn();
    callCount++;
  });
  return {
    latest: () => latest,
    count: () => callCount,
    stop,
  };
}

// ---------------------------------------------------------------------------
// Map tests
// ---------------------------------------------------------------------------

describe("createReactive(new Map()) — reactive Map", () => {
  it("instanceof Map is preserved", () => {
    const m = createReactive(new Map<string, number>());
    expect(m instanceof Map).toBe(true);
  });

  it("basic get/set round-trip (non-reactive context)", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    expect(m.get("a")).toBe(1);
    m.set("b", 2);
    expect(m.get("b")).toBe(2);
    expect(m.size).toBe(2);
  });

  it("has() returns correct membership", () => {
    const m = createReactive(new Map<string, number>([["x", 10]]));
    expect(m.has("x")).toBe(true);
    expect(m.has("y")).toBe(false);
  });

  it("delete() removes entry", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    expect(m.delete("a")).toBe(true);
    expect(m.has("a")).toBe(false);
    expect(m.delete("a")).toBe(false);
  });

  it("clear() empties the map", () => {
    const m = createReactive(
      new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    );
    m.clear();
    expect(m.size).toBe(0);
    expect(m.has("a")).toBe(false);
  });

  // ── Per-key isolation ───────────────────────────────────────────────────

  it("per-key isolation: reading m.get('a') does NOT re-run on m.set('b', …)", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const { count } = tracked(() => m.get("a"));

    expect(count()).toBe(1);
    m.set("b", 99);
    expect(count()).toBe(1); // no re-run — b was not subscribed
  });

  it("per-key reactive: reading m.get('a') re-runs when m.set('a', …)", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const { latest, count } = tracked(() => m.get("a"));

    expect(latest()).toBe(1);
    m.set("a", 42);
    expect(latest()).toBe(42);
    expect(count()).toBe(2);
  });

  it("has() subscribes to per-key signal and re-runs on set/delete", () => {
    const m = createReactive(new Map<string, number>());
    const { latest, count } = tracked(() => m.has("a"));

    expect(latest()).toBe(false);
    expect(count()).toBe(1);

    m.set("a", 1);
    expect(latest()).toBe(true);
    expect(count()).toBe(2);

    m.delete("a");
    expect(latest()).toBe(false);
    expect(count()).toBe(3);
  });

  // ── Iteration tracks structure ──────────────────────────────────────────

  it("iteration tracks structure: entries() re-runs on add", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const { latest, count } = tracked(() => {
      const result: Array<[string, number]> = [];
      for (const [k, v] of m.entries()) {
        result.push([k, v]);
      }
      return result;
    });

    expect(latest()).toEqual([["a", 1]]);
    expect(count()).toBe(1);

    m.set("b", 2);
    expect(latest()).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
    expect(count()).toBe(2);
  });

  it("iteration tracks structure: keys() re-runs on delete", () => {
    const m = createReactive(
      new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const { latest, count } = tracked(() => [...m.keys()]);

    expect(latest()).toEqual(["a", "b"]);
    m.delete("a");
    expect(latest()).toEqual(["b"]);
    expect(count()).toBe(2);
  });

  it("iteration tracks structure: size re-runs on add/delete", () => {
    const m = createReactive(new Map<string, number>());
    const { latest, count } = tracked(() => m.size);

    expect(latest()).toBe(0);
    m.set("x", 1);
    expect(latest()).toBe(1);
    expect(count()).toBe(2);
    m.delete("x");
    expect(latest()).toBe(0);
    expect(count()).toBe(3);
  });

  // ── Iteration tracks per-entry mutation ────────────────────────────────

  it("values() iteration re-runs when a visited key's value changes via set()", () => {
    const m = createReactive(
      new Map<string, { n: number }>([
        ["a", { n: 1 }],
        ["b", { n: 2 }],
      ]),
    );
    const { latest, count } = tracked(() => {
      const result: Array<number> = [];
      for (const v of m.values()) {
        result.push(v.n);
      }
      return result;
    });

    expect(latest()).toEqual([1, 2]);
    expect(count()).toBe(1);

    // Replace value for key "a" entirely
    m.set("a", { n: 99 });
    expect(latest()).toEqual([99, 2]);
    expect(count()).toBe(2);
  });

  // ── Per-key signal continuity across delete ─────────────────────────────

  it("per-key signal continuity across delete: re-runs on delete then on re-set", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const calls: Array<number | undefined> = [];
    const stop = effect(() => {
      calls.push(m.get("a"));
    });

    expect(calls).toEqual([1]);

    m.delete("a");
    expect(calls).toEqual([1, undefined]);

    m.set("a", 42);
    expect(calls).toEqual([1, undefined, 42]);

    stop();
  });

  // ── Per-key signal continuity across clear ──────────────────────────────

  it("per-key signal continuity across clear: re-runs on clear then on re-set", () => {
    const m = createReactive(
      new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const calls: Array<number | undefined> = [];
    const stop = effect(() => {
      calls.push(m.get("a"));
    });

    expect(calls).toEqual([1]);

    m.clear();
    expect(calls).toEqual([1, undefined]);

    m.set("a", 99);
    expect(calls).toEqual([1, undefined, 99]);

    stop();
  });

  // ── Non-tracked reads skip subscription ────────────────────────────────

  it("non-tracked reads skip subscription: get and has outside effect don't re-subscribe", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const effectFn = vi.fn(() => {
      m.get("a");
      m.has("a");
    });

    // Read outside any effect — no subscriptions created
    m.get("a");
    m.has("a");

    // Now subscribe in an effect
    effect(effectFn);
    expect(effectFn).toHaveBeenCalledTimes(1);

    // Mutate — effect should re-run once (because it subscribed during the effect run)
    m.set("a", 2);
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  // ── Wrap convention — outputs ───────────────────────────────────────────

  it("get(k) returns a reactive proxy for object values", () => {
    const raw = { x: 1 };
    const m = createReactive(new Map<string, { x: number }>([["a", raw]]));
    const val = m.get("a")!;

    // Mutation through the returned proxy should propagate
    const { latest } = tracked(() => m.get("a")?.x);
    expect(latest()).toBe(1);

    val.x = 42;
    expect(latest()).toBe(42);
  });

  it("set(k1, v1).set(k2, v2) chains return the reactive proxy", () => {
    const m = createReactive(new Map<string, number>());
    const result = m.set("a", 1).set("b", 2);
    expect(result).toBe(m);
    expect(m.get("a")).toBe(1);
    expect(m.get("b")).toBe(2);
  });

  it("iterating entries() yields wrapped keys and wrapped values", () => {
    const rawKey = { id: "k1" };
    const rawVal = { name: "v1" };
    const m = createReactive(new Map<{ id: string }, { name: string }>([[rawKey, rawVal]]));

    for (const [k, v] of m.entries()) {
      // Both key and value should be reactive proxies
      expect(unwrap(k)).toBe(rawKey);
      expect(unwrap(v)).toBe(rawVal);
    }
  });

  it("forEach third callback arg is the reactive proxy", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    m.forEach((_v, _k, mapArg) => {
      expect(mapArg).toBe(m);
    });
  });

  it("exposes internal symbols and preserves bound native methods", () => {
    const raw = new Map<string, number>([["a", 1]]);
    Object.defineProperty(raw, "tag", { value: "custom", configurable: true });
    const m = createReactive(raw);

    expect($RAW in m).toBe(true);
    expect($PROXY in m).toBe(true);
    expect((m as Map<string, number> & { [$RAW]: Map<string, number> })[$RAW]).toBe(raw);
    expect((m as Map<string, number> & { [$PROXY]: Map<string, number> })[$PROXY]).toBe(m);
    expect(Object.prototype.toString.call(m)).toBe("[object Map]");

    const get = m.get;
    const has = m.has;
    expect(get("a")).toBe(1);
    expect(has("a")).toBe(true);
    // Detached prototype-fallthrough method still binds back to the raw target.
    const toString = m.toString;
    expect(toString()).toBe("[object Map]");
    expect((m as Map<string, number> & { tag: string }).tag).toBe("custom");
    expect("missing" in m).toBe(false);
  });

  it("tracks Map.forEach values inside effects", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const values: Array<Array<number>> = [];

    const stop = effect(() => {
      const next: Array<number> = [];
      m.forEach((value) => next.push(value));
      values.push(next);
    });

    m.set("a", 2);
    expect(values).toEqual([[1], [2]]);
    stop();
  });

  // ── Wrap convention — inputs ────────────────────────────────────────────

  it("m.get(rawKey) and m.get(wrappedKey) find the same entry", () => {
    const rawKey = { id: "k1" };
    const m = createReactive(new Map<{ id: string }, number>([[rawKey, 42]]));
    // Wrap the key through createReactive
    const wrappedObjMap = createReactive(new Map<string, { id: string }>([["ref", rawKey]]));
    const wrappedK = wrappedObjMap.get("ref")!;
    expect(unwrap(wrappedK)).toBe(rawKey);

    // Both raw and wrapped key should find the same entry
    expect(m.get(rawKey)).toBe(42);
    expect(m.get(wrappedK as { id: string })).toBe(42);
  });

  it("m.set(k, wrappedValue) stores the raw value", () => {
    const rawVal = { n: 1 };
    const wrappedVal = createReactive(rawVal);
    const m = createReactive(new Map<string, { n: number }>());

    m.set("a", wrappedVal);
    // unwrap(m) is the raw Map; its stored value should be the raw object
    const rawMap = unwrap(m);
    expect(rawMap.get("a")).toBe(rawVal);
  });

  // ── Nested reactivity ───────────────────────────────────────────────────

  it("m.get('user') returns a reactive proxy — mutations to it propagate", () => {
    const user = { name: "Alice" };
    const m = createReactive(new Map<string, { name: string }>([["user", user]]));

    const { latest, count } = tracked(() => m.get("user")?.name);
    expect(latest()).toBe("Alice");

    m.get("user")!.name = "Bob";
    expect(latest()).toBe("Bob");
    expect(count()).toBe(2);
  });

  // ── Batch coalescing ────────────────────────────────────────────────────

  it("N writes inside batch() fire one notification per affected key", () => {
    const m = createReactive(new Map<string, number>([["a", 0]]));
    const effectFn = vi.fn(() => m.get("a"));

    effect(effectFn);
    expect(effectFn).toHaveBeenCalledTimes(1);

    batch(() => {
      m.set("a", 1);
      m.set("a", 2);
      m.set("a", 3);
    });

    expect(effectFn).toHaveBeenCalledTimes(2);
    expect(m.get("a")).toBe(3);
  });

  it("setting an existing key to the same value is a no-op for subscribers", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const effectFn = vi.fn(() => m.get("a"));

    effect(effectFn);
    expect(effectFn).toHaveBeenCalledTimes(1);

    m.set("a", 1);
    expect(effectFn).toHaveBeenCalledTimes(1);
  });

  // ── unwrap ──────────────────────────────────────────────────────────────

  it("unwrap(m) returns the original raw Map", () => {
    const raw = new Map<string, number>([["a", 1]]);
    const m = createReactive(raw);
    expect(unwrap(m)).toBe(raw);
  });

  // ── Property-based test ─────────────────────────────────────────────────

  it("property-based: arbitrary operations match a plain Map model", () => {
    type Op =
      | { type: "set"; key: string; value: number }
      | { type: "delete"; key: string }
      | { type: "clear" }
      | { type: "has"; key: string }
      | { type: "get"; key: string };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({
        type: fc.constant<"set">("set"),
        key: fc.string({ maxLength: 3 }),
        value: fc.integer(),
      }),
      fc.record({ type: fc.constant<"delete">("delete"), key: fc.string({ maxLength: 3 }) }),
      fc.constant({ type: "clear" as const }),
      fc.record({ type: fc.constant<"has">("has"), key: fc.string({ maxLength: 3 }) }),
      fc.record({ type: fc.constant<"get">("get"), key: fc.string({ maxLength: 3 }) }),
    );

    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 30 }), (ops) => {
        const raw = new Map<string, number>();
        const reactive = createReactive(new Map<string, number>());

        for (const op of ops) {
          switch (op.type) {
            case "set":
              raw.set(op.key, op.value);
              reactive.set(op.key, op.value);
              break;
            case "delete":
              raw.delete(op.key);
              reactive.delete(op.key);
              break;
            case "clear":
              raw.clear();
              reactive.clear();
              break;
            case "has":
              expect(reactive.has(op.key)).toBe(raw.has(op.key));
              break;
            case "get":
              expect(reactive.get(op.key)).toBe(raw.get(op.key));
              break;
          }
        }

        // Final state check via unwrap
        const rawUnderlying = unwrap(reactive);
        expect(rawUnderlying.size).toBe(raw.size);
        for (const [k, v] of raw) {
          expect(rawUnderlying.get(k)).toBe(v);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Set tests
// ---------------------------------------------------------------------------

describe("createReactive(new Set()) — reactive Set", () => {
  it("instanceof Set is preserved", () => {
    const s = createReactive(new Set<string>());
    expect(s instanceof Set).toBe(true);
  });

  it("basic add/has/delete round-trip", () => {
    const s = createReactive(new Set<string>());
    s.add("a");
    expect(s.has("a")).toBe(true);
    expect(s.size).toBe(1);
    s.delete("a");
    expect(s.has("a")).toBe(false);
  });

  it("clear() empties the set", () => {
    const s = createReactive(new Set<string>(["a", "b"]));
    s.clear();
    expect(s.size).toBe(0);
  });

  // ── Structural reactivity ───────────────────────────────────────────────

  it("has() re-runs on add/delete", () => {
    const s = createReactive(new Set<string>());
    const { latest, count } = tracked(() => s.has("a"));

    expect(latest()).toBe(false);
    s.add("a");
    expect(latest()).toBe(true);
    expect(count()).toBe(2);
    s.delete("a");
    expect(latest()).toBe(false);
    expect(count()).toBe(3);
  });

  it("size re-runs on add/delete", () => {
    const s = createReactive(new Set<string>());
    const { latest, count } = tracked(() => s.size);

    expect(latest()).toBe(0);
    s.add("x");
    expect(latest()).toBe(1);
    expect(count()).toBe(2);
  });

  it("values() iteration re-runs on add", () => {
    const s = createReactive(new Set<string>(["a"]));
    const { latest, count } = tracked(() => [...s.values()]);

    expect(latest()).toEqual(["a"]);
    s.add("b");
    expect(latest()).toEqual(["a", "b"]);
    expect(count()).toBe(2);
  });

  it("forEach re-runs on structural change", () => {
    const s = createReactive(new Set<string>(["a"]));
    const collected: Array<Array<string>> = [];
    const stop = effect(() => {
      const arr: Array<string> = [];
      s.forEach((v) => arr.push(v));
      collected.push(arr);
    });

    expect(collected).toEqual([["a"]]);
    s.add("b");
    expect(collected).toEqual([["a"], ["a", "b"]]);
    stop();
  });

  it("add() of an existing value does not re-run subscribers", () => {
    const s = createReactive(new Set<string>(["a"]));
    const { count } = tracked(() => s.size);

    expect(count()).toBe(1);
    s.add("a"); // already present
    expect(count()).toBe(1); // no re-run
  });

  it("delete() returns false for missing value and does not re-run subscribers", () => {
    const s = createReactive(new Set<string>());
    const { count } = tracked(() => s.size);

    expect(count()).toBe(1);
    expect(s.delete("missing")).toBe(false);
    expect(count()).toBe(1);
  });

  it("clear() on empty set does not re-run subscribers", () => {
    const s = createReactive(new Set<string>());
    const { count } = tracked(() => s.size);

    expect(count()).toBe(1);
    s.clear();
    expect(count()).toBe(1);
  });

  it("exposes internal symbols and preserves bound native Set methods", () => {
    const raw = new Set<string>(["a"]);
    Object.defineProperty(raw, "tag", { value: "custom", configurable: true });
    const s = createReactive(raw);

    expect($RAW in s).toBe(true);
    expect($PROXY in s).toBe(true);
    expect((s as Set<string> & { [$RAW]: Set<string> })[$RAW]).toBe(raw);
    expect((s as Set<string> & { [$PROXY]: Set<string> })[$PROXY]).toBe(s);
    expect(Object.prototype.toString.call(s)).toBe("[object Set]");

    const has = s.has;
    const keys = s.keys;
    const entries = s.entries;
    expect(has("a")).toBe(true);
    expect([...keys()]).toEqual(["a"]);
    expect([...entries()]).toEqual([["a", "a"]]);
    expect([...s]).toEqual(["a"]);
    // Detached prototype-fallthrough method still binds back to the raw target.
    const toString = s.toString;
    expect(toString()).toBe("[object Set]");
    expect((s as Set<string> & { tag: string }).tag).toBe("custom");
    expect("missing" in s).toBe(false);
  });

  // ── Wrap convention ─────────────────────────────────────────────────────

  it("add(v).add(v2) chains return the reactive proxy", () => {
    const s = createReactive(new Set<string>());
    const result = s.add("a").add("b");
    expect(result).toBe(s);
  });

  it("values() yields wrapped values (object members stay reactive)", () => {
    const rawObj = { n: 1 };
    const s = createReactive(new Set<{ n: number }>([rawObj]));

    const { latest, count } = tracked(() => {
      const arr: Array<number> = [];
      for (const v of s.values()) {
        arr.push(v.n);
      }
      return arr;
    });

    expect(latest()).toEqual([1]);
    // Mutate the wrapped object returned from iteration
    for (const v of s.values()) {
      v.n = 42;
    }
    expect(latest()[0]).toBe(42);
    expect(count()).toBeGreaterThanOrEqual(2);
  });

  it("forEach third callback arg is the reactive proxy", () => {
    const s = createReactive(new Set<string>(["a"]));
    s.forEach((_v, _v2, setArg) => {
      expect(setArg).toBe(s);
    });
  });

  // ── unwrap ──────────────────────────────────────────────────────────────

  it("unwrap(s) returns the original raw Set", () => {
    const raw = new Set<string>(["a"]);
    const s = createReactive(raw);
    expect(unwrap(s)).toBe(raw);
  });

  // ── Property-based test ─────────────────────────────────────────────────

  it("property-based: arbitrary operations match a plain Set model", () => {
    type Op =
      | { type: "add"; value: string }
      | { type: "delete"; value: string }
      | { type: "clear" }
      | { type: "has"; value: string };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ type: fc.constant<"add">("add"), value: fc.string({ maxLength: 3 }) }),
      fc.record({ type: fc.constant<"delete">("delete"), value: fc.string({ maxLength: 3 }) }),
      fc.constant({ type: "clear" as const }),
      fc.record({ type: fc.constant<"has">("has"), value: fc.string({ maxLength: 3 }) }),
    );

    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 30 }), (ops) => {
        const raw = new Set<string>();
        const reactive = createReactive(new Set<string>());

        for (const op of ops) {
          switch (op.type) {
            case "add":
              raw.add(op.value);
              reactive.add(op.value);
              break;
            case "delete":
              raw.delete(op.value);
              reactive.delete(op.value);
              break;
            case "clear":
              raw.clear();
              reactive.clear();
              break;
            case "has":
              expect(reactive.has(op.value)).toBe(raw.has(op.value));
              break;
          }
        }

        const rawUnderlying = unwrap(reactive);
        expect(rawUnderlying.size).toBe(raw.size);
        for (const v of raw) {
          expect(rawUnderlying.has(v)).toBe(true);
        }
      }),
    );
  });

  // ── Batch coalescing ────────────────────────────────────────────────────

  it("N structural writes inside batch() fire one notification", () => {
    const s = createReactive(new Set<string>());
    const effectFn = vi.fn(() => s.size);

    effect(effectFn);
    expect(effectFn).toHaveBeenCalledTimes(1);

    batch(() => {
      s.add("a");
      s.add("b");
      s.add("c");
    });

    expect(effectFn).toHaveBeenCalledTimes(2);
    expect(s.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Map nested inside a reactive object
// ---------------------------------------------------------------------------

describe("Map nested inside createReactive object", () => {
  it("accessing a nested Map returns a reactive Map proxy", () => {
    const inner = new Map<string, number>([["x", 10]]);
    const state = createReactive({ cache: inner });

    const { latest, count } = tracked(() => state.cache.get("x"));
    expect(latest()).toBe(10);

    state.cache.set("x", 99);
    expect(latest()).toBe(99);
    expect(count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tracking precision
// ---------------------------------------------------------------------------

describe("Map tracking precision", () => {
  it("keys() does NOT re-run when an existing key's value changes", () => {
    const m = createReactive(
      new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    );
    const { count } = tracked(() => [...m.keys()]);

    expect(count()).toBe(1);
    m.set("a", 99); // value change for existing key — structurally a no-op for keys()
    m.set("b", 100);
    expect(count()).toBe(1);

    m.set("c", 3); // structural change
    expect(count()).toBe(2);
    m.delete("a"); // structural change
    expect(count()).toBe(3);
  });

  it("set() on an unobserved key does not leak signals into iteration tracking", () => {
    const m = createReactive(new Map<string, number>([["read", 1]]));
    const { count } = tracked(() => m.get("read"));

    expect(count()).toBe(1);

    m.set("never-read", 100);
    m.set("never-read", 200);
    m.set("never-read", 300);

    expect(count()).toBe(1);
  });
});

describe("Set mutator batching", () => {
  it("add() fires one notification (not two) for $OWN_KEYS + $VERSION", () => {
    const s = createReactive(new Set<string>());
    const effectFn = vi.fn(() => s.size);
    effect(effectFn);
    expect(effectFn).toHaveBeenCalledTimes(1);

    s.add("a");
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("delete() fires one notification", () => {
    const s = createReactive(new Set<string>(["a"]));
    const effectFn = vi.fn(() => s.size);
    effect(effectFn);

    s.delete("a");
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("clear() fires one notification", () => {
    const s = createReactive(new Set<string>(["a", "b"]));
    const effectFn = vi.fn(() => s.size);
    effect(effectFn);

    s.clear();
    expect(effectFn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Proxy idempotency / wrap discrimination
// ---------------------------------------------------------------------------

describe("createReactive idempotency", () => {
  it("createReactive(reactiveMap) returns the same proxy reference", () => {
    const m = createReactive(new Map<string, number>([["a", 1]]));
    const m2 = createReactive(m);
    expect(m2).toBe(m);
  });

  it("createReactive(reactiveSet) returns the same proxy reference", () => {
    const s = createReactive(new Set<string>(["a"]));
    const s2 = createReactive(s);
    expect(s2).toBe(s);
  });

  it("createReactive(reactiveObject) returns the same proxy reference", () => {
    const o = createReactive({ a: 1 });
    const o2 = createReactive(o);
    expect(o2).toBe(o);
  });

  it("storing a reactive Map back into a reactive object does not double-wrap", () => {
    const m = createReactive(new Map<string, number>([["x", 1]]));
    const state = createReactive<{ cache: Map<string, number> | null }>({ cache: null });
    state.cache = m;
    expect(state.cache).toBe(m);
  });
});

describe("wrap() discrimination — non-plain values pass through", () => {
  it("Date values stored in a reactive Map are not proxied", () => {
    const d = new Date(2026, 0, 1);
    const m = createReactive(new Map<string, Date>());
    m.set("when", d);
    const out = m.get("when")!;
    expect(out).toBe(d); // not wrapped — same reference
    expect(out.getFullYear()).toBe(2026); // internal slot still works
  });

  it("RegExp values stored in a reactive Map are not proxied", () => {
    const r = /abc/g;
    const m = createReactive(new Map<string, RegExp>());
    m.set("pat", r);
    const out = m.get("pat")!;
    expect(out).toBe(r);
    expect(out.test("zabcz")).toBe(true);
  });

  it("class instances stored in a reactive Map are not proxied", () => {
    class Box {
      constructor(public n: number) {}
      double() {
        return this.n * 2;
      }
    }
    const b = new Box(21);
    const m = createReactive(new Map<string, Box>());
    m.set("b", b);
    const out = m.get("b")!;
    expect(out).toBe(b);
    expect(out.double()).toBe(42);
  });

  it("plain objects stored in a reactive Map ARE proxied", () => {
    const obj = { a: 1 };
    const m = createReactive(new Map<string, { a: number }>());
    m.set("o", obj);
    const out = m.get("o")!;
    // The wrapped proxy is a different reference from the raw, but unwraps to it.
    expect(unwrap(out)).toBe(obj);
  });
});
