// A native array method called with the proxy as `this` loses V8's fast path
// and goes through a trap per element (~280x slower), so these run on the raw
// target instead.
//
// Early-exit methods (find, some, every, findIndex) are deliberately absent:
// through the proxy they subscribe only to the indices they visit.
//
// Imports read.ts circularly: safe only while neither module reads the
// other's bindings at evaluation time.

import { getActiveSub, startBatch, endBatch } from "alien-signals";

import { $OWN_KEYS, getNode, getNodes, trackArrayElements, unwrap } from "./core";
import { wrap } from "./read";
import { readSignal } from "./render-reads";
import { notifyArrayMutation } from "./write";

export type NativeArrayMethod = (...args: Array<unknown>) => unknown;

type RawArrayMethod = (
  target: Array<unknown>,
  receiver: unknown,
  native: NativeArrayMethod,
  args: Array<unknown>,
) => unknown;

type FirstChanged = (args: Array<unknown>, length: number) => number;

const atStart: FirstChanged = () => 0;
const atEnd: FirstChanged = (_args, length) => length;
const atLast: FirstChanged = (_args, length) => Math.max(length - 1, 0);
const atArgument =
  (position: number): FirstChanged =>
  (args, length) => {
    const n = Math.trunc(Number(args[position])) || 0;
    return n < 0 ? Math.max(length + n, 0) : Math.min(n, length);
  };

const RETURNED = -1;
const ALL = Infinity;

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

const sort: RawArrayMethod = (target, receiver, native, args) => {
  const [compare] = args;
  return reorder(
    target,
    receiver,
    native,
    typeof compare === "function" ? [(a: unknown, b: unknown) => compare(wrap(a), wrap(b))] : args,
  );
};

// Covers every index change only together with the own-keys subscription the
// get trap made when the method was read.
function trackWholeArray(target: ReadonlyArray<unknown>): void {
  if (getActiveSub()) {
    readSignal(getNode(getNodes(target), "length", target.length));
    trackArrayElements(target);
  }
}

function iterator(result: Result): RawArrayMethod {
  return (target, receiver, native, args) => {
    const [callback, thisArg] = args;
    if (typeof callback !== "function") {
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
    // Without an initial value the accumulator would start as a raw element.
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

type ProxiedMethod = (this: unknown, ...args: Array<unknown>) => unknown;

// Shared across arrays (resolved from `this`) so `array.push === array.push`.
function proxied([name, run]: readonly [string, RawArrayMethod]): [string, ProxiedMethod] {
  return [
    name,
    function arrayMethod(this: unknown, ...args: Array<unknown>): unknown {
      const target = unwrap(this) as Array<unknown>;
      return run(target, this, target[name as keyof Array<unknown>] as NativeArrayMethod, args);
    },
  ];
}

export const ARRAY_METHODS: ReadonlyMap<PropertyKey, ProxiedMethod> = new Map(
  (
    [
      ["push", mutator(atEnd, 0, returnAsIs)],
      ["pop", mutator(atLast, 1, returnElement)],
      ["shift", mutator(atStart, 1, returnElement)],
      ["unshift", mutator(atStart, 0, returnAsIs)],
      ["splice", mutator(atArgument(0), RETURNED, returnElements)],
      ["copyWithin", mutator(atArgument(0), ALL, returnArray)],
      ["fill", mutator(atArgument(1), ALL, returnArray)],
      ["reverse", reorder],
      ["sort", sort],
      ["map", iterator(returnAsIs)],
      ["forEach", iterator(returnAsIs)],
      ["flatMap", iterator(returnAsIs)],
      ["filter", iterator(returnElements)],
      ["reduce", reduce],
      ["reduceRight", reduce],
    ] as const
  ).map(proxied),
);

export function trackArrayItems(target: ReadonlyArray<unknown>): void {
  readSignal(getNode(getNodes(target), $OWN_KEYS, 0));
  trackWholeArray(target);
}
