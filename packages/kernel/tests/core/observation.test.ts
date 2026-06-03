// =============================================================================
// observation.test.ts
// =============================================================================
//
// The reactive-observation lifecycle primitive: `onObservationChange(node, {
// onUnobserved })` fires when a node loses its last subscriber — coalesced and
// re-checked on a microtask, so a node unobserved and re-observed within the
// same turn fires nothing. `getObservationNode` returns a reactive proxy's
// dedicated liveness node; `trackNode`/`isObserved` subscribe-to / inspect a
// node. This is the kernel half of `@supergrain/silo`'s signals-native fetch
// cancellation.
// =============================================================================
import { describe, it, expect } from "vitest";

import { createReactive, effect, getObservationNode, onObservationChange } from "../../src";
import { getActiveSub, isObserved, setActiveSub, trackNode } from "../../src/internal";

// `onUnobserved` is dispatched on a microtask; await one so assertions see it.
const flush = () => Promise.resolve();

// Subscribe `node` to a fresh effect (mirrors a component observing a handle).
// Returns a disposer that unsubscribes — exactly like a component unmounting.
function observe(node: ReturnType<typeof getObservationNode>): () => void {
  return effect(() => {
    trackNode(node);
  });
}

describe("onObservationChange", () => {
  it("fires onUnobserved after a microtask once a node loses its last subscriber", async () => {
    const proxy = createReactive({ a: 1 });
    const node = getObservationNode(proxy);

    let unobserved = 0;
    onObservationChange(node, { onUnobserved: () => unobserved++ });

    const dispose = observe(node);
    expect(isObserved(node)).toBe(true);

    dispose();
    expect(isObserved(node)).toBe(false);
    expect(unobserved).toBe(0); // deferred, not synchronous

    await flush();
    expect(unobserved).toBe(1);
  });

  it("does NOT fire when a node is unobserved then re-observed within the same turn", async () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let unobserved = 0;
    onObservationChange(node, { onUnobserved: () => unobserved++ });

    const dispose = observe(node);
    dispose(); // unobserved...
    const dispose2 = observe(node); // ...re-observed before the microtask flush

    await flush();
    expect(unobserved).toBe(0); // coalesced away — no thrash

    dispose2();
    await flush();
    expect(unobserved).toBe(1);
  });

  it("only fires for the last subscriber when several observe the same node", async () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let unobserved = 0;
    onObservationChange(node, { onUnobserved: () => unobserved++ });

    const d1 = observe(node);
    const d2 = observe(node);

    d1();
    await flush();
    expect(unobserved).toBe(0); // d2 still observes

    d2();
    await flush();
    expect(unobserved).toBe(1);
  });

  it("coalesces many nodes unobserved in one turn into a single flush", async () => {
    let fired = 0;
    const disposers = Array.from({ length: 5 }, () => {
      const node = getObservationNode(createReactive({ a: 1 }));
      onObservationChange(node, { onUnobserved: () => fired++ });
      return observe(node);
    });

    for (const d of disposers) d();
    expect(fired).toBe(0);
    await flush();
    expect(fired).toBe(5);
  });

  it("unregister stops the handler from firing", async () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let unobserved = 0;
    const unregister = onObservationChange(node, { onUnobserved: () => unobserved++ });

    unregister();
    observe(node)();
    await flush();
    expect(unobserved).toBe(0);
  });

  it("unregister drops a node already queued for the flush", async () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let unobserved = 0;
    const unregister = onObservationChange(node, { onUnobserved: () => unobserved++ });

    observe(node)(); // queues the node for the microtask
    unregister(); // ...but we unregister before it flushes
    await flush();
    expect(unobserved).toBe(0);
  });

  it("a second unregister call is a no-op", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    const unregister = onObservationChange(node, { onUnobserved: () => {} });
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  it("re-registering replaces the prior handler", async () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let first = 0;
    let second = 0;
    onObservationChange(node, { onUnobserved: () => first++ });
    onObservationChange(node, { onUnobserved: () => second++ });

    observe(node)();
    await flush();
    expect(first).toBe(0);
    expect(second).toBe(1);
  });
});

describe("getObservationNode", () => {
  it("returns the same node for the same proxy (idempotent)", () => {
    const proxy = createReactive({ a: 1 });
    expect(getObservationNode(proxy)).toBe(getObservationNode(proxy));
  });

  it("returns a stable node even for a frozen target", () => {
    const frozen = Object.freeze({ a: 1 });
    const node = getObservationNode(frozen);
    expect(node).toBeDefined();
    // Cannot stash on a frozen target, so it falls back to a WeakMap — but must
    // still dedupe so observation works.
    expect(getObservationNode(frozen)).toBe(node);
  });

  it("resolves the raw target behind a proxy", () => {
    const raw = { a: 1 };
    const proxy = createReactive(raw);
    expect(getObservationNode(proxy)).toBe(getObservationNode(raw));
  });
});

describe("trackNode / isObserved", () => {
  it("trackNode is a no-op when there is no active subscriber", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    const prev = setActiveSub(undefined);
    try {
      trackNode(node);
      expect(isObserved(node)).toBe(false);
    } finally {
      setActiveSub(prev);
    }
    expect(getActiveSub()).toBe(prev);
  });

  it("isObserved reflects whether the node has subscribers", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    expect(isObserved(node)).toBe(false);
    const dispose = observe(node);
    expect(isObserved(node)).toBe(true);
    dispose();
    expect(isObserved(node)).toBe(false);
  });
});
