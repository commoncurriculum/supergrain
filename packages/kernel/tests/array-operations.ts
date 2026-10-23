// A shared model of arbitrary array mutations, used by the property suites that
// need to drive a reactive array through many shapes: `write/property.test.ts`
// (reactive array vs. plain-array replay) and `core/property.test.ts`
// (`stableComputed` reconciling to a fresh recompute).
//
// Both need the same thing — "any sequence of realistic array mutations" — so
// the operation alphabet, its arbitrary, and the reducer live here once.
// `reverse` and `sort` are part of that alphabet deliberately: they are the
// reordering transforms whose slot-by-slot rewrites `stableComputed` documents
// as its worst case.

import fc from "fast-check";

export type ArrayOperation =
  | { type: "push"; value: number }
  | { type: "pop" }
  | { type: "shift" }
  | { type: "unshift"; value: number }
  | { type: "setIndex"; index: number; value: number }
  | { type: "splice"; start: number; deleteCount: number; items: Array<number> }
  | { type: "reverse" }
  | { type: "sort" };

export const integerArbitrary = fc.integer({ min: -20, max: 20 });
const itemsArbitrary = fc.array(integerArbitrary, { maxLength: 4 });

export const arrayOperationArbitrary: fc.Arbitrary<ArrayOperation> = fc.oneof(
  fc.record({ type: fc.constant<"push">("push"), value: integerArbitrary }),
  fc.constant<ArrayOperation>({ type: "pop" }),
  fc.constant<ArrayOperation>({ type: "shift" }),
  fc.record({ type: fc.constant<"unshift">("unshift"), value: integerArbitrary }),
  fc.record({
    type: fc.constant<"setIndex">("setIndex"),
    index: fc.integer({ min: 0, max: 20 }),
    value: integerArbitrary,
  }),
  fc.record({
    type: fc.constant<"splice">("splice"),
    start: fc.integer({ min: 0, max: 20 }),
    deleteCount: fc.integer({ min: 0, max: 20 }),
    items: itemsArbitrary,
  }),
  fc.constant<ArrayOperation>({ type: "reverse" }),
  fc.constant<ArrayOperation>({ type: "sort" }),
);

// Generated indices are wrapped into range rather than filtered, so every
// generated operation does something instead of being silently discarded.
function normalizeIndex(index: number, length: number): number {
  return length === 0 ? 0 : ((index % length) + length) % length;
}

function normalizeSpliceStart(start: number, length: number): number {
  return ((start % (length + 1)) + (length + 1)) % (length + 1);
}

/** Apply one operation in place. Works on a plain array or a reactive one. */
export function applyArrayOperation(items: Array<number>, operation: ArrayOperation): void {
  switch (operation.type) {
    case "push": {
      items.push(operation.value);
      return;
    }
    case "pop": {
      items.pop();
      return;
    }
    case "shift": {
      items.shift();
      return;
    }
    case "unshift": {
      items.unshift(operation.value);
      return;
    }
    case "setIndex": {
      items[normalizeIndex(operation.index, items.length)] = operation.value;
      return;
    }
    case "splice": {
      const start = normalizeSpliceStart(operation.start, items.length);
      const deleteCount = operation.deleteCount % (items.length - start + 1);
      items.splice(start, deleteCount, ...operation.items);
      return;
    }
    case "reverse": {
      items.reverse();
      return;
    }
    case "sort": {
      items.sort((left, right) => left - right);
      return;
    }
  }
}
