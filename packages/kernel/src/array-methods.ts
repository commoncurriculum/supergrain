/**
 * Raw-array implementations of array methods. The proxy's `get` trap
 * (read.ts) returns these in place of the native methods.
 *
 * Called through the proxy, a native array method runs with the proxy as
 * `this`: V8 drops its fast array path and every element read and write goes
 * through a trap (~280x slower than on a plain array), each write firing its
 * own notifications. These run the native method on the raw target instead:
 *
 * - Mutators run inside one batch, then `notifyArrayMutation` fires the
 *   signals the change touched, once — synchronous effects never observe a
 *   partial state.
 * - Whole-array iterators subscribe once to the array's `length` and
 *   `$ELEMENTS` signals instead of to every index (see `trackWholeArray`).
 *   Callbacks still get reactive elements.
 *
 * A method not listed in `ARRAY_METHODS` keeps the proxy route: trap by trap
 * and, for a mutator, unbatched, so synchronous effects can observe its
 * partial states (React renderers via `tracked()` are unaffected — React
 * batches `forceUpdate` calls). Early-exit methods (`find`, `some`, `every`,
 * `findIndex`, …) stay on that route on purpose: through the proxy they
 * subscribe only to the indices they visit, and a whole-array subscription
 * would wake them for changes they skip.
 *
 * Like collections.ts, this module and read.ts import each other. That is
 * safe because neither reads the other's bindings while it is being
 * evaluated — only when a method is called.
 */

import { getActiveSub, startBatch, endBatch } from "alien-signals";

import { $OWN_KEYS, getNode, getNodes, trackArrayElements } from "./core";
import { wrap } from "./read";
import { notifyArrayMutation } from "./write";

/** The method as the target holds it, e.g. `Array.prototype.push`. */
export type NativeArrayMethod = (...args: Array<unknown>) => unknown;

type RawArrayMethod = (
  target: Array<unknown>,
  receiver: unknown,
  native: NativeArrayMethod,
  args: Array<unknown>,
) => unknown;

// The first index a mutator can change, given its arguments and the old
// length.
type FirstChanged = (args: Array<unknown>, length: number) => number;

const atStart: FirstChanged = () => 0;
const atEnd: FirstChanged = (_args, length) => length;
const atLast: FirstChanged = (_args, length) => Math.max(length - 1, 0);
// A start or target argument, clamped the way the spec clamps relative indices.
const atArgument =
  (position: number): FirstChanged =>
  (args, length) => {
    const n = Math.trunc(Number(args[position])) || 0;
    return n < 0 ? Math.max(length + n, 0) : Math.min(n, length);
  };

// How many items from the first changed index a mutator replaces, copied
// before it runs; the items after them only move. `RETURNED`: the native
// method returns them (`splice`), so nothing is copied.
const RETURNED = -1;
const ALL = Infinity;

// Turns the native return value into what the same call through the proxy
// returns: elements come back reactive, and `this` is the proxy.
type Result = (value: unknown, receiver: unknown) => unknown;

const returnAsIs: Result = (value) => value;
const returnElement: Result = (value) => wrap(value);
const returnElements: Result = (value) => {
  const elements = value as Array<unknown>;
  for (let i = 0; i < elements.length; i++) elements[i] = wrap(elements[i]);
  return elements;
};
const returnArray: Result = (_value, receiver) => receiver;

function mutator(firstChanged: FirstChanged, replaced: number, result: Result): RawArrayMethod {
  return (target, receiver, native, args) => {
    const oldLength = target.length;
    const from = firstChanged(args, oldLength);
    const copied = replaced === RETURNED ? undefined : target.slice(from, from + replaced);
    startBatch();
    try {
      const value = native.apply(target, args);
      notifyArrayMutation(target, from, copied ?? (value as Array<unknown>), oldLength);
      return result(value, receiver);
    } finally {
      endBatch();
    }
  };
}

const reorder = mutator(atStart, ALL, returnArray);

// A reorder whose comparator sees elements the way a read through the proxy
// would.
const sort: RawArrayMethod = (target, receiver, native, args) => {
  const [compare] = args;
  return reorder(
    target,
    receiver,
    native,
    typeof compare === "function" ? [(a: unknown, b: unknown) => compare(wrap(a), wrap(b))] : args,
  );
};

// Whenever an index signal changes, so does `length` (the array grew or
// shrank), `$ELEMENTS` (an element was replaced in place), or own-keys (a hole
// was filled). The get trap already subscribed to own-keys when the method was
// read, so these two complete a pass's dependencies on the array itself.
function trackWholeArray(target: ReadonlyArray<unknown>): void {
  if (getActiveSub()) {
    getNode(getNodes(target), "length", target.length)();
    trackArrayElements(target);
  }
}

function iterator(result: Result): RawArrayMethod {
  return (target, receiver, native, args) => {
    const [callback, thisArg] = args;
    if (typeof callback !== "function") {
      // Let the native method throw its TypeError.
      return native.apply(receiver, args);
    }
    trackWholeArray(target);
    const value = native.call(target, (element: unknown, index: number) =>
      callback.call(thisArg, wrap(element), index, receiver),
    );
    return result(value, receiver);
  };
}

const reduce: RawArrayMethod = (target, receiver, native, args) => {
  const [callback, initial] = args;
  if (typeof callback !== "function" || args.length < 2) {
    // A bad callback: let the native method throw. No initial value: the
    // accumulator would start as a raw element, so take the proxy route,
    // which starts it as a reactive one.
    return native.apply(receiver, args);
  }
  trackWholeArray(target);
  return native.call(
    target,
    (acc: unknown, element: unknown, index: number) =>
      callback(acc, wrap(element), index, receiver),
    initial,
  );
};

/** Every array method the proxy's `get` trap replaces, by name. */
export const ARRAY_METHODS: ReadonlyMap<PropertyKey, RawArrayMethod> = new Map([
  // Mutators: the first index each can change, how many items from there it
  // replaces, and what it returns.
  ["push", mutator(atEnd, 0, returnAsIs)],
  ["pop", mutator(atLast, 1, returnElement)],
  ["shift", mutator(atStart, 1, returnElement)],
  ["unshift", mutator(atStart, 0, returnAsIs)],
  ["splice", mutator(atArgument(0), RETURNED, returnElements)],
  ["copyWithin", mutator(atArgument(0), ALL, returnArray)],
  ["fill", mutator(atArgument(1), ALL, returnArray)],
  ["reverse", reorder],
  ["sort", sort],
  // Whole-array iterators.
  ["map", iterator(returnAsIs)],
  ["forEach", iterator(returnAsIs)],
  ["flatMap", iterator(returnAsIs)],
  ["filter", iterator(returnElements)],
  ["reduce", reduce],
  ["reduceRight", reduce],
]);

/**
 * Subscribe the active computed to every change in `target`'s items without
 * reading them: what a whole-array `forEach` subscribes to, plus own keys
 * (which the get trap adds when a method is read).
 */
export function trackArrayItems(target: ReadonlyArray<unknown>): void {
  getNode(getNodes(target), $OWN_KEYS, 0)();
  trackWholeArray(target);
}
