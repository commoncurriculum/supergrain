// =============================================================================
// observation.test.ts
// =============================================================================
//
// The reactive-observation lifecycle primitive: `onObservationChange` fires
// `onUnobserved` when a node loses its last subscriber and `onObserved` when it
// gains its first. `getObservationNode` returns a reactive proxy's dedicated
// liveness node; `trackNode`/`isObserved` subscribe-to / inspect a node. This is
// the kernel half of `@supergrain/silo`'s signals-native fetch cancellation.
// =============================================================================
import { describe, it, expect } from "vitest";

import { createReactive, effect, getObservationNode, onObservationChange } from "../../src";
import { getActiveSub, isObserved, setActiveSub, trackNode } from "../../src/internal";

// Subscribe `node` to a fresh effect (mirrors a component observing a handle).
// Returns a disposer that unsubscribes — exactly like a component unmounting.
function observe(node: ReturnType<typeof getObservationNode>): () => void {
  return effect(() => {
    trackNode(node);
  });
}

describe("onObservationChange", () => {
  it("fires onUnobserved when a node loses its last subscriber", () => {
    const proxy = createReactive({ a: 1 });
    const node = getObservationNode(proxy);

    let unobserved = 0;
    onObservationChange(node, { onUnobserved: () => unobserved++ });

    const dispose = observe(node);
    expect(isObserved(node)).toBe(true);
    expect(unobserved).toBe(0);

    dispose();
    expect(isObserved(node)).toBe(false);
    expect(unobserved).toBe(1);
  });

  it("fires onObserved only on the first subscriber, not subsequent ones", () => {
    const node = getObservationNode(createReactive({ a: 1 }));

    let observed = 0;
    onObservationChange(node, { onObserved: () => observed++ });

    const d1 = observe(node);
    expect(observed).toBe(1);

    const d2 = observe(node); // second observer — no onObserved
    expect(observed).toBe(1);

    d1();
    d2();
    expect(observed).toBe(1);
  });

  it("re-fires onObserved after the node returns to unobserved and is observed again", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let observed = 0;
    let unobserved = 0;
    onObservationChange(node, {
      onObserved: () => observed++,
      onUnobserved: () => unobserved++,
    });

    observe(node)();
    expect(observed).toBe(1);
    expect(unobserved).toBe(1);

    observe(node)();
    expect(observed).toBe(2);
    expect(unobserved).toBe(2);
  });

  it("unregister stops handlers from firing", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let unobserved = 0;
    const unregister = onObservationChange(node, { onUnobserved: () => unobserved++ });

    unregister();
    observe(node)();
    expect(unobserved).toBe(0);
  });

  it("a second unregister call is a no-op", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    const unregister = onObservationChange(node, { onUnobserved: () => {} });
    unregister();
    expect(() => unregister()).not.toThrow();
  });

  it("tracks onObserved registrations across replace and unregister", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let first = 0;
    let second = 0;
    // Register with onObserved, then replace with another that also has
    // onObserved (the replace path adjusts the first-observer dispatch count).
    onObservationChange(node, { onObserved: () => first++ });
    const unregister = onObservationChange(node, { onObserved: () => second++ });

    observe(node)();
    expect(first).toBe(0);
    expect(second).toBe(1);

    unregister(); // drops the active onObserved registration
    observe(node)();
    expect(second).toBe(1); // no longer fires
  });

  it("re-registering replaces the prior handlers", () => {
    const node = getObservationNode(createReactive({ a: 1 }));
    let first = 0;
    let second = 0;
    onObservationChange(node, { onUnobserved: () => first++ });
    onObservationChange(node, { onUnobserved: () => second++ });

    observe(node)();
    expect(first).toBe(0);
    expect(second).toBe(1);
  });
});

describe("getObservationNode", () => {
  it("returns the same node for the same proxy (idempotent)", () => {
    const proxy = createReactive({ a: 1 });
    expect(getObservationNode(proxy)).toBe(getObservationNode(proxy));
  });

  it("returns a node even for a frozen target (cannot stash, falls back)", () => {
    const frozen = Object.freeze({ a: 1 });
    const node = getObservationNode(frozen);
    expect(node).toBeDefined();
    // Cannot be deduped (no place to stash it), but must not throw.
    expect(() => getObservationNode(frozen)).not.toThrow();
  });

  it("resolves the raw target behind a proxy", () => {
    const proxy = createReactive({ a: 1 });
    // Reading through the proxy and the raw value yields the same liveness node.
    expect(getObservationNode(proxy)).toBe(getObservationNode(proxy));
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
