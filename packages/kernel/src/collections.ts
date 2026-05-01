/**
 * Reactive wrappers for Map and Set.
 *
 * Map methods read internal slots, so `new Proxy(map, handler)` alone cannot
 * intercept `proxy.get(k)` with the right semantics. Instead the `get` trap
 * returns custom, signal-aware reimplementations that delegate to the raw
 * collection via `Reflect` / direct calls.
 *
 * `instanceof Map` / `instanceof Set` continue to hold because the Proxy
 * target is the original collection.
 *
 * Internal only — not exported from the package root. `createReactive()` /
 * `wrap()` dispatch here when the value is a Map or Set.
 */

import { getCurrentSub, startBatch, endBatch, signal } from "alien-signals";

import {
  $OWN_KEYS,
  $RAW,
  $PROXY,
  $VERSION,
  getNode,
  getNodes,
  getNodesIfExist,
  isWrappable,
  nextBump,
  unwrap,
  type ReactiveTagged,
  type Signal,
} from "./core";
import { profileSignalRead, profileSignalSkip, profileSignalWrite } from "./profiler";
// ---------------------------------------------------------------------------
// Lazy wrap helper — defined here to avoid a circular import from read.ts.
// We import createReactiveProxy from read.ts; read.ts imports our factories;
// ES module live-binding semantics make this safe as long as neither module
// accesses the imported binding at top-level evaluation time (they don't).
// ---------------------------------------------------------------------------
import { createReactiveProxy } from "./read";

function wrap<T>(value: T): T {
  if (!isWrappable(value)) {
    return value;
  }
  return createReactiveProxy(value) as T;
}

// ---------------------------------------------------------------------------
// Per-Map key-signal storage.
//
// `keySignals` is kept alive by the method closures below — no external
// WeakMap is needed. A module-level `keySignalsStore` WeakMap was previously
// maintained here but was never read from outside this function (dead code);
// removing it eliminates an unnecessary allocation and WeakMap entry per Map.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Proxy cache — one proxy per raw Map/Set.
//
// Primary cache: $PROXY stored directly on the raw target as a non-enumerable
// property (intrusive pattern, same as how plain objects are handled in
// read.ts). This is faster than a module-level WeakMap lookup and keeps the
// tracking metadata co-located with the object being tracked.
//
// Fallback: sealedCollectionCache WeakMap for sealed / non-extensible
// collections where Object.defineProperty($PROXY) fails. These are
// extraordinarily rare in practice.
// ---------------------------------------------------------------------------

const sealedCollectionCache = new WeakMap<object, object>();

// ---------------------------------------------------------------------------
// Signal helpers — read/bump $OWN_KEYS and per-key signals.
// ---------------------------------------------------------------------------

function trackOwnKeys(target: object): void {
  if (getCurrentSub()) {
    const nodes = getNodes(target);
    getNode(nodes, $OWN_KEYS, 0)();
  }
}

// Whenever this module creates `nodes` for a Map/Set, it also creates
// $OWN_KEYS and $VERSION (see `reactiveSet`/`reactiveAdd`). So once `nodes`
// exists for one of these targets, both signals are present — the `!`
// asserts that invariant.
function bumpOwnKeys(target: object): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) return;
  profileSignalWrite();
  nodes[$OWN_KEYS]!(nextBump());
}

function bumpVersionSignal(target: object): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) return;
  nodes[$VERSION]!(nextBump());
}

// ---------------------------------------------------------------------------
// createReactiveMap
// ---------------------------------------------------------------------------

export function createReactiveMap<K, V>(rawTarget: Map<K, V>): Map<K, V> {
  // Primary proxy cache: $PROXY stored directly on the raw target.
  const existing = (rawTarget as ReactiveTagged)[$PROXY] as Map<K, V> | undefined;
  if (existing) return existing;
  // Fallback for sealed Maps where defineProperty($PROXY) fails.
  const existingSealed = sealedCollectionCache.get(rawTarget) as Map<K, V> | undefined;
  if (existingSealed) return existingSealed;

  // keySignals is kept alive by the closures in `methods` below.
  // No external WeakMap is needed to maintain its lifetime.
  const keySignals = new Map<K, Signal<V | undefined>>();

  function getOrCreateKeySignal(rawKey: K): Signal<V | undefined> {
    let s = keySignals.get(rawKey);
    if (!s) {
      s = signal(rawTarget.get(rawKey)) as Signal<V | undefined>;
      keySignals.set(rawKey, s);
    }
    return s;
  }

  // Pre-create method functions once per Map instance so the `get` trap can
  // return a stable reference instead of allocating a new closure each time.
  // `proxyRef` is assigned after `new Proxy(...)` below; closures capture
  // variables by reference, so by the time any method is *called* it holds
  // the proxy. Returning `proxyRef` (rather than `this`) keeps the original
  // behavior when callers extract methods, e.g.
  // `const set = mapProxy.set; set(k, v)` still returns the proxy.
  let proxyRef: Map<K, V> = undefined as unknown as Map<K, V>;

  const methods = {
    get: function reactiveGet(key: K): V | undefined {
      const rawKey = unwrap(key);
      if (getCurrentSub()) {
        profileSignalRead();
        const s = getOrCreateKeySignal(rawKey);
        const v = s() as V | undefined;
        return wrap(v);
      }
      profileSignalSkip();
      return wrap(rawTarget.get(rawKey));
    },

    has: function reactiveHas(key: K): boolean {
      const rawKey = unwrap(key);
      if (getCurrentSub()) {
        profileSignalRead();
        getOrCreateKeySignal(rawKey)();
      } else {
        profileSignalSkip();
      }
      return rawTarget.has(rawKey);
    },

    set: function reactiveSet(key: K, value: V): Map<K, V> {
      const rawKey = unwrap(key);
      const rawValue = unwrap(value);
      const isNew = !rawTarget.has(rawKey);
      const oldRawValue = rawTarget.get(rawKey);

      rawTarget.set(rawKey, rawValue);

      const didChange = unwrap(oldRawValue) !== unwrap(rawValue);

      if (isNew) {
        // New key: batch per-key bump + structural bumps into one notification.
        // Don't create a per-key signal eagerly here — only update one if a
        // prior tracked read already created it. Subsequent reads will
        // create the signal lazily with the current value.
        startBatch();
        try {
          const s = keySignals.get(rawKey);
          if (s) {
            profileSignalWrite();
            s(rawValue);
          }
          // Ensure $VERSION and $OWN_KEYS signals exist before bumping.
          const nodes = getNodes(rawTarget);
          getNode(nodes, $VERSION, 0);
          getNode(nodes, $OWN_KEYS, 0);
          bumpOwnKeys(rawTarget);
          bumpVersionSignal(rawTarget);
        } finally {
          endBatch();
        }
      } else if (didChange) {
        // Existing key, value changed: only per-key bump — no structural change.
        const s = keySignals.get(rawKey);
        if (s) {
          profileSignalWrite();
          s(rawValue);
        }
      }

      return proxyRef;
    },

    delete: function reactiveDelete(key: K): boolean {
      const rawKey = unwrap(key);
      if (!rawTarget.has(rawKey)) return false;

      rawTarget.delete(rawKey);

      // Batch per-key bump + structural bumps so subscribers fire once.
      startBatch();
      try {
        // Bump per-key signal to undefined (signal persists for re-set).
        const s = keySignals.get(rawKey);
        if (s) {
          profileSignalWrite();
          s(void 0 as V | undefined);
        }
        bumpOwnKeys(rawTarget);
        bumpVersionSignal(rawTarget);
      } finally {
        endBatch();
      }
      return true;
    },

    clear: function reactiveClear(): void {
      if (rawTarget.size === 0) return;

      // Iterate keySignals (lazily-created per-key signals) rather than
      // spreading rawTarget.keys() into a temporary array. keySignals only
      // contains entries for keys that were ever tracked, which is typically
      // much smaller than rawTarget. We clear the raw map inside the batch
      // so structural subscribers fire only once.
      startBatch();
      try {
        // Bump every tracked per-key signal to undefined; keep the signal
        // objects so subscribers remain attached for subsequent re-sets.
        for (const [k, s] of keySignals) {
          if (rawTarget.has(k)) {
            profileSignalWrite();
            s(void 0 as V | undefined);
          }
        }

        rawTarget.clear();
        bumpOwnKeys(rawTarget);
        bumpVersionSignal(rawTarget);
      } finally {
        endBatch();
      }
    },

    forEach: function reactiveForEach(
      callbackFn: (value: V, key: K, map: Map<K, V>) => void,
    ): void {
      trackOwnKeys(rawTarget);
      for (const [k, v] of rawTarget.entries()) {
        if (getCurrentSub()) {
          profileSignalRead();
          getOrCreateKeySignal(k)();
        }
        callbackFn(wrap(v), wrap(k), proxyRef);
      }
    },

    entries: function* reactiveEntries(): IterableIterator<[K, V]> {
      trackOwnKeys(rawTarget);
      for (const [k, v] of rawTarget.entries()) {
        if (getCurrentSub()) {
          profileSignalRead();
          getOrCreateKeySignal(k)();
        }
        yield [wrap(k), wrap(v)];
      }
    },

    keys: function* reactiveKeys(): IterableIterator<K> {
      // keys() is structurally dependent only on the key set — it must not
      // subscribe to per-key value signals, or effects iterating only keys
      // would re-run on every value change.
      trackOwnKeys(rawTarget);
      for (const k of rawTarget.keys()) {
        yield wrap(k);
      }
    },

    values: function* reactiveValues(): IterableIterator<V> {
      trackOwnKeys(rawTarget);
      for (const [k, v] of rawTarget.entries()) {
        if (getCurrentSub()) {
          profileSignalRead();
          getOrCreateKeySignal(k)();
        }
        yield wrap(v);
      }
    },
  } as const;

  const handler: ProxyHandler<Map<K, V>> = {
    get(target, prop) {
      // ── Internal symbols ─────────────────────────────────────────────────
      if (prop === $RAW) return target;
      if (prop === $PROXY) return proxyRef;

      // ── size ─────────────────────────────────────────────────────────────
      if (prop === "size") {
        trackOwnKeys(target);
        return target.size;
      }

      // ── named methods — return stable pre-created functions ───────────────
      if (prop === "get") return methods.get;
      if (prop === "has") return methods.has;
      if (prop === "set") return methods.set;
      if (prop === "delete") return methods.delete;
      if (prop === "clear") return methods.clear;
      if (prop === "forEach") return methods.forEach;
      if (prop === "keys") return methods.keys;
      if (prop === "values") return methods.values;

      // ── entries / Symbol.iterator ─────────────────────────────────────────
      if (prop === "entries" || prop === Symbol.iterator) return methods.entries;

      // ── Symbol.toStringTag ───────────────────────────────────────────────
      if (prop === Symbol.toStringTag) return "Map";

      // ── toString / toLocaleString / constructor / other prototype props ──
      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },

    has(target, prop) {
      if (prop === $RAW || prop === $PROXY) return true;
      return Reflect.has(target, prop);
    },
  };

  const proxy = new Proxy(rawTarget, handler);
  proxyRef = proxy;
  try {
    Object.defineProperty(rawTarget, $PROXY, { value: proxy, enumerable: false });
  } catch {
    sealedCollectionCache.set(rawTarget, proxy);
  }
  return proxy;
}
// ---------------------------------------------------------------------------

export function createReactiveSet<T>(rawTarget: Set<T>): Set<T> {
  // Primary proxy cache: $PROXY stored directly on the raw target.
  const existing = (rawTarget as ReactiveTagged)[$PROXY] as Set<T> | undefined;
  if (existing) return existing;
  // Fallback for sealed Sets where defineProperty($PROXY) fails.
  const existingSealed = sealedCollectionCache.get(rawTarget) as Set<T> | undefined;
  if (existingSealed) return existingSealed;

  // Pre-create method functions once per Set instance (same rationale as Map).
  // Methods that return the proxy use `proxyRef` (assigned after `new Proxy`)
  // so that extracting a method, e.g. `const add = setProxy.add; add(v)`,
  // still returns the proxy and preserves chaining.
  let proxyRef: Set<T> = undefined as unknown as Set<T>;

  const methods = {
    has: function reactiveHas(value: T): boolean {
      trackOwnKeys(rawTarget);
      return rawTarget.has(unwrap(value));
    },

    add: function reactiveAdd(value: T): Set<T> {
      const rawValue = unwrap(value);
      if (rawTarget.has(rawValue)) return proxyRef;

      rawTarget.add(rawValue);

      startBatch();
      try {
        const nodes = getNodes(rawTarget);
        getNode(nodes, $VERSION, 0);
        getNode(nodes, $OWN_KEYS, 0);
        bumpOwnKeys(rawTarget);
        bumpVersionSignal(rawTarget);
      } finally {
        endBatch();
      }

      return proxyRef;
    },

    delete: function reactiveDelete(value: T): boolean {
      const rawValue = unwrap(value);
      if (!rawTarget.has(rawValue)) return false;

      rawTarget.delete(rawValue);
      startBatch();
      try {
        bumpOwnKeys(rawTarget);
        bumpVersionSignal(rawTarget);
      } finally {
        endBatch();
      }
      return true;
    },

    clear: function reactiveClear(): void {
      if (rawTarget.size === 0) return;
      rawTarget.clear();
      startBatch();
      try {
        bumpOwnKeys(rawTarget);
        bumpVersionSignal(rawTarget);
      } finally {
        endBatch();
      }
    },

    forEach: function reactiveForEach(
      callbackFn: (value: T, value2: T, set: Set<T>) => void,
    ): void {
      trackOwnKeys(rawTarget);
      for (const v of rawTarget.values()) {
        callbackFn(wrap(v), wrap(v), proxyRef);
      }
    },

    values: function* reactiveValues(): IterableIterator<T> {
      trackOwnKeys(rawTarget);
      for (const v of rawTarget.values()) {
        yield wrap(v);
      }
    },

    // Set.prototype.keys() is identical to values() per spec.
    keys: function* reactiveKeys(): IterableIterator<T> {
      trackOwnKeys(rawTarget);
      for (const v of rawTarget.values()) {
        yield wrap(v);
      }
    },

    entries: function* reactiveEntries(): IterableIterator<[T, T]> {
      trackOwnKeys(rawTarget);
      for (const v of rawTarget.values()) {
        yield [wrap(v), wrap(v)];
      }
    },
  } as const;

  const handler: ProxyHandler<Set<T>> = {
    get(target, prop) {
      // ── Internal symbols ─────────────────────────────────────────────────
      if (prop === $RAW) return target;
      if (prop === $PROXY) return proxyRef;

      // ── size ─────────────────────────────────────────────────────────────
      if (prop === "size") {
        trackOwnKeys(target);
        return target.size;
      }

      // ── named methods — return stable pre-created functions ───────────────
      if (prop === "has") return methods.has;
      if (prop === "add") return methods.add;
      if (prop === "delete") return methods.delete;
      if (prop === "clear") return methods.clear;
      if (prop === "forEach") return methods.forEach;
      if (prop === "keys") return methods.keys;
      if (prop === "entries") return methods.entries;

      // ── values / Symbol.iterator ──────────────────────────────────────────
      if (prop === "values" || prop === Symbol.iterator) return methods.values;

      // ── Symbol.toStringTag ───────────────────────────────────────────────
      if (prop === Symbol.toStringTag) return "Set";

      const value = Reflect.get(target, prop);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },

    has(target, prop) {
      if (prop === $RAW || prop === $PROXY) return true;
      return Reflect.has(target, prop);
    },
  };

  const proxy = new Proxy(rawTarget, handler);
  proxyRef = proxy;
  try {
    Object.defineProperty(rawTarget, $PROXY, { value: proxy, enumerable: false });
  } catch {
    sealedCollectionCache.set(rawTarget, proxy);
  }
  return proxy;
}
