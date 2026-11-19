import { setActiveSub, signal } from "alien-signals";

import { readSignal } from "./render-reads";

// Type-only brand: no store carries this property at runtime.
export const $BRAND = Symbol.for("supergrain:brand");

export type Branded<T> =
  T extends Array<infer U>
    ? Array<Branded<U>>
    : T extends (...args: Array<any>) => any
      ? T
      : T extends Map<infer K, infer V>
        ? Map<K, V> & { readonly [$BRAND]?: true }
        : T extends Set<infer E>
          ? Set<E> & { readonly [$BRAND]?: true }
          : T extends object
            ? { [K in keyof T]: Branded<T[K]> } & { readonly [$BRAND]?: true }
            : T;

export interface Signal<T> {
  (): T;
  (value: T): void;
}

export const $NODE = Symbol.for("supergrain:node");
export const $PROXY = Symbol.for("supergrain:proxy");
export const $TRACK = Symbol.for("supergrain:track");
export const $RAW = Symbol.for("supergrain:raw");
export const $VERSION = Symbol.for("supergrain:version");
export const $ELEMENTS = Symbol.for("supergrain:elements");
export const $OWN_KEYS = Symbol.for("ownKeys");
export const $HAS_FIELD_NODES = Symbol("supergrain:has-field-nodes");

export interface ReactiveTagged {
  [$RAW]?: object;
  [$PROXY]?: object;
  [$NODE]?: DataNodes;
  [$TRACK]?: object;
}

export type DataNodes = Record<PropertyKey, Signal<unknown>>;

export function unwrap<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  return ((value as ReactiveTagged)[$RAW] as T | undefined) ?? value;
}

export function isWrappable(value: unknown): value is object {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value) || value instanceof Map || value instanceof Set) {
    return true;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The target's signal nodes, or undefined if none exist yet. Never creates them. */
export function getNodesIfExist(target: object): DataNodes | undefined {
  return (target as ReactiveTagged)[$NODE];
}

// No Object.prototype in the chain, or nodes["valueOf"] would resolve to an
// inherited method. Built with `new`, not Object.create(null): V8 puts
// null-prototype objects in slow dictionary mode at ~3x the memory.
function Nodes(): void {}
Nodes.prototype = Object.create(null);

export function getNodes(target: object): DataNodes {
  let nodes = (target as ReactiveTagged)[$NODE];
  if (!nodes) {
    nodes = new (Nodes as unknown as new () => DataNodes)();
    // A frozen object won't take it, and gets fresh (untracked) nodes per read.
    defineHidden(target, $NODE, nodes);
  }
  return nodes;
}

// Reused so defineHidden allocates no descriptor per call.
const hiddenValue: PropertyDescriptor = { value: undefined, configurable: true };

// Returns false, not throws, for non-extensible targets and refusing proxies.
export function defineHidden(target: object, key: PropertyKey, value: unknown): boolean {
  hiddenValue.value = value;
  try {
    return Reflect.defineProperty(target, key, hiddenValue);
  } catch {
    return false;
  } finally {
    hiddenValue.value = undefined;
  }
}

// Fires only on in-place element replacement. Structural changes (push,
// splice, length) bump the version/ownKeys signals instead.
export function trackArrayElements(target: object): void {
  readSignal(getNode(getNodes(target), $ELEMENTS, 0));
}

export function getNode(nodes: DataNodes, property: PropertyKey, value?: unknown): Signal<unknown> {
  if (nodes[property]) {
    return nodes[property]!;
  }
  const newSignal = signal(value) as Signal<unknown>;
  nodes[property] = newSignal;
  return newSignal;
}

export function untracked<R>(fn: () => R): R {
  const prevSub = setActiveSub(undefined);
  try {
    return fn();
  } finally {
    setActiveSub(prevSub);
  }
}
