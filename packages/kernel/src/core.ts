import { createObservationNode, signal, type ReactiveNode } from "./system";

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
export const $OBSERVE = Symbol.for("supergrain:observe");
export const $OWN_KEYS = Symbol.for("ownKeys");

// Well-known symbol properties attached to reactive proxy targets and proxies.
// Typed as optional so structural subtype checks pass for plain objects.
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

// Single source of truth for what `createReactive` will proxy. Plain objects
// (incl. null-prototype), arrays, Maps, and Sets only — everything else
// (Date, RegExp, class instances, functions, primitives) passes through.
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

/** Get nodes if they already exist (no creation). Fast path for hot loops. */
export function getNodesIfExist(target: object): DataNodes | undefined {
  return (target as ReactiveTagged)[$NODE];
}

export function getNodes(target: object): DataNodes {
  let nodes = (target as ReactiveTagged)[$NODE];
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
    nodes[$VERSION] = signal(0) as Signal<unknown>;
  }
  return nodes;
}

export function getNode(nodes: DataNodes, property: PropertyKey, value?: unknown): Signal<unknown> {
  if (nodes[property]) {
    return nodes[property]!;
  }
  const newSignal = signal(value) as Signal<unknown>;
  nodes[property] = newSignal;
  return newSignal;
}

// Fallback liveness-node store for targets that can't carry the `$OBSERVE`
// property (frozen / non-extensible). Keyed by raw target so the node is still
// deduped (observation would silently break if each call returned a new node).
const frozenObservationNodes = new WeakMap<object, ReactiveNode>();

/**
 * Retrieve the dedicated "liveness" reactive node for a reactive proxy,
 * creating it lazily and stashing it on the raw target. Unlike the per-property
 * signals (which fire on writes), the liveness node is never written — it exists
 * purely so observation primitives (`onObservationChange`/`trackNode`/
 * `isObserved`) can detect when the proxy has no remaining reactive observers.
 *
 * The node is stable across calls for a given target (incl. frozen targets, via
 * a WeakMap fallback), so observation handlers attach to the same node a reader
 * subscribes to.
 */
export function getObservationNode(value: object): ReactiveNode {
  const raw = unwrap(value) as ReactiveTagged & { [$OBSERVE]?: ReactiveNode };
  const existing = raw[$OBSERVE] ?? frozenObservationNodes.get(raw);
  if (existing) return existing;

  const node = createObservationNode();
  try {
    Object.defineProperty(raw, $OBSERVE, {
      value: node,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Frozen / non-extensible target: keep the node deduped via the WeakMap.
    frozenObservationNodes.set(raw, node);
  }
  return node;
}
