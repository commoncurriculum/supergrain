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
export const $ELEMENTS = Symbol.for("supergrain:elements");
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

/**
 * Subscribe the active subscriber to the array's coarse `$ELEMENTS` signal —
 * "some element of this array was replaced in place" — creating the signal on
 * demand. One dependency link covers every index, present and future, so a
 * subscriber that diffs the whole array on wake (parent-mode `For`'s swap
 * effect) doesn't need N per-index subscriptions. Structural changes (push,
 * splice, length, new array) are NOT reported here; they bump the version /
 * ownKeys signals instead.
 */
export function trackArrayElements(target: object): void {
  getNode(getNodes(target), $ELEMENTS, 0)();
}

export function getNode(nodes: DataNodes, property: PropertyKey, value?: unknown): Signal<unknown> {
  if (nodes[property]) {
    return nodes[property]!;
  }
  const newSignal = signal(value) as Signal<unknown>;
  nodes[property] = newSignal;
  return newSignal;
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------

/**
 * The counter behind every "something here changed" signal write.
 *
 * Its value is never observed. All that matters is that each write differs
 * from the one before it on the same signal, so `Object.is` inside the signal
 * sees a change and subscribers re-run.
 *
 * It is a module-local `++` rather than `signal(signal() + 1)` because reading
 * the signal would subscribe the active subscriber to the very signal about to
 * be written, turning any proxy mutation inside a tracked render into a
 * self-triggering loop.
 *
 * One counter for the whole kernel, deliberately. Two counters can drift to
 * the same value, and any signal written by both would then swallow the second
 * write: `Object.is` sees no change, no subscriber re-runs, and the UI goes
 * quietly stale — the exact failure this library exists to make impossible.
 * Today the write and collection paths happen to own disjoint targets, so
 * nothing enforces that but coincidence. Sharing one counter makes the
 * collision unrepresentable instead of merely unlikely.
 */
let BUMP = 0;

/** Writes a value the signal does not currently hold, so subscribers re-run. */
export function bumpSignal(node: Signal<unknown>): void {
  node(++BUMP);
}
