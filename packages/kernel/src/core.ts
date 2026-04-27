import { signal } from "alien-signals";

// Phantom brand for compile-time store identification (no runtime property).
// Exported as a real symbol so consumers can reference `typeof $BRAND` in type positions.
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
export const $OWN_KEYS = Symbol.for("ownKeys");

export type DataNodes = Record<PropertyKey, Signal<any>>;

export function unwrap<T>(value: T): T {
  return (value && (value as any)[$RAW]) || value;
}

/** Get nodes if they already exist (no creation). Fast path for hot loops. */
export function getNodesIfExist(target: object): DataNodes | undefined {
  return (target as any)[$NODE];
}

export function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE];
  if (!nodes) {
    // Null-prototype: avoid inherited methods (toString, valueOf, hasOwnProperty,
    // …) being mistaken for per-key signal nodes during writes. With a plain
    // `{}` here, `setProperty` writing key="valueOf" would resolve `nodes[key]`
    // to `Object.prototype.valueOf` (truthy function) and call it as a signal
    // setter, throwing.
    nodes = Object.create(null) as DataNodes;
    try {
      Object.defineProperty(target, $NODE, {
        value: nodes,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // Frozen objects can't be modified.
    }
  }
  // Ensure version signal exists (lazy creation)
  if (!nodes[$VERSION]) {
    nodes[$VERSION] = signal(0) as Signal<any>;
  }
  return nodes;
}

export function getNode(nodes: DataNodes, property: PropertyKey, value?: any): Signal<any> {
  if (nodes[property]) {
    return nodes[property]!;
  }
  const newSignal = signal(value) as Signal<any>;
  nodes[property] = newSignal;
  return newSignal;
}
