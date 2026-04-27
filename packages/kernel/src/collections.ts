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

import { getCurrentSub, startBatch, endBatch } from "alien-signals";
import { signal } from "alien-signals";

import { $OWN_KEYS, $RAW, $PROXY, $VERSION, getNode, getNodes, getNodesIfExist, unwrap, type Signal } from "./core";
import { profileSignalRead, profileSignalSkip, profileSignalWrite } from "./profiler";

// ---------------------------------------------------------------------------
// Lazy wrap helper — defined here to avoid a circular import from read.ts.
// We import createReactiveProxy from read.ts; read.ts imports our factories;
// ES module live-binding semantics make this safe as long as neither module
// accesses the imported binding at top-level evaluation time (they don't).
// ---------------------------------------------------------------------------

import { createReactiveProxy } from "./read";

function wrap<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return createReactiveProxy(value as object) as T;
}

// ---------------------------------------------------------------------------
// Monotonic bump counter — mirrors the one in write.ts (each only needs to
// differ from the *previous* value on the same signal).
// ---------------------------------------------------------------------------

let BUMP = 0;

// ---------------------------------------------------------------------------
// Per-Map key-signal storage.
//
// We cannot store per-key signals in $NODE (which is Record<PropertyKey, …>
// and cannot hold arbitrary Map keys). Instead we keep a WeakMap from the
// raw Map to a Map<K, Signal<V|undefined>> of per-key signals.
// ---------------------------------------------------------------------------

const keySignalsStore = new WeakMap<Map<unknown, unknown>, Map<unknown, Signal<unknown>>>();

function getKeySignals<K, V>(target: Map<K, V>): Map<K, Signal<V | undefined>> {
  let ks = keySignalsStore.get(target as Map<unknown, unknown>);
  if (!ks) {
    ks = new Map<unknown, Signal<unknown>>();
    keySignalsStore.set(target as Map<unknown, unknown>, ks);
  }
  return ks as Map<K, Signal<V | undefined>>;
}

// ---------------------------------------------------------------------------
// Proxy cache — one proxy per raw Map/Set (mirrors proxyCache in read.ts).
// ---------------------------------------------------------------------------

const collectionProxyCache = new WeakMap<object, object>();

// ---------------------------------------------------------------------------
// Signal helpers — read/bump $OWN_KEYS and per-key signals.
// ---------------------------------------------------------------------------

function trackOwnKeys(target: object): void {
  if (getCurrentSub()) {
    const nodes = getNodes(target);
    getNode(nodes, $OWN_KEYS, 0)();
  }
}

function bumpOwnKeys(target: object): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) return;
  const s = nodes[$OWN_KEYS];
  if (s) {
    profileSignalWrite();
    s(++BUMP);
  }
}

function bumpVersionSignal(target: object): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) return;
  const s = nodes[$VERSION];
  if (s) {
    s(++BUMP);
  }
}

// ---------------------------------------------------------------------------
// createReactiveMap
// ---------------------------------------------------------------------------

export function createReactiveMap<K, V>(rawTarget: Map<K, V>): Map<K, V> {
  if (collectionProxyCache.has(rawTarget)) {
    return collectionProxyCache.get(rawTarget) as Map<K, V>;
  }

  const keySignals = getKeySignals(rawTarget);

  function getOrCreateKeySignal(rawKey: K): Signal<V | undefined> {
    let s = keySignals.get(rawKey);
    if (!s) {
      s = signal(rawTarget.get(rawKey)) as Signal<V | undefined>;
      keySignals.set(rawKey, s);
    }
    return s;
  }

  // proxy is declared here so closures inside the handler can reference it.
  let proxy!: Map<K, V>;

  const handler: ProxyHandler<Map<K, V>> = {
    get(target, prop) {
      // ── Internal symbols ─────────────────────────────────────────────────
      if (prop === $RAW) return target;
      if (prop === $PROXY) return proxy;

      // ── size ─────────────────────────────────────────────────────────────
      if (prop === "size") {
        trackOwnKeys(target);
        return target.size;
      }

      // ── get ──────────────────────────────────────────────────────────────
      if (prop === "get") {
        return function reactiveGet(key: K): V | undefined {
          const rawKey = unwrap(key) as K;
          if (getCurrentSub()) {
            profileSignalRead();
            const s = getOrCreateKeySignal(rawKey);
            const v = s();
            return wrap(v) as V | undefined;
          }
          profileSignalSkip();
          return wrap(rawTarget.get(rawKey)) as V | undefined;
        };
      }

      // ── has ──────────────────────────────────────────────────────────────
      if (prop === "has") {
        return function reactiveHas(key: K): boolean {
          const rawKey = unwrap(key) as K;
          if (getCurrentSub()) {
            profileSignalRead();
            getOrCreateKeySignal(rawKey)();
          } else {
            profileSignalSkip();
          }
          return rawTarget.has(rawKey);
        };
      }

      // ── set ──────────────────────────────────────────────────────────────
      if (prop === "set") {
        return function reactiveSet(key: K, value: V): Map<K, V> {
          const rawKey = unwrap(key) as K;
          const rawValue = unwrap(value) as V;
          const isNew = !rawTarget.has(rawKey);
          const oldRawValue = rawTarget.get(rawKey);

          rawTarget.set(rawKey, rawValue);

          const didChange = unwrap(oldRawValue) !== unwrap(rawValue);

          if (isNew) {
            // New key: batch per-key bump + structural bumps into one notification.
            startBatch();
            try {
              if (didChange || isNew) {
                const s = getOrCreateKeySignal(rawKey);
                profileSignalWrite();
                s(rawValue);
              }
              // Ensure $VERSION and $OWN_KEYS signals exist before bumping.
              const nodes = getNodes(target);
              getNode(nodes, $VERSION, 0);
              getNode(nodes, $OWN_KEYS, 0);
              bumpOwnKeys(target);
              bumpVersionSignal(target);
            } finally {
              endBatch();
            }
          } else if (didChange) {
            // Existing key, value changed: only per-key bump — no structural change.
            const s = getOrCreateKeySignal(rawKey);
            profileSignalWrite();
            s(rawValue);
          }

          return proxy;
        };
      }

      // ── delete ───────────────────────────────────────────────────────────
      if (prop === "delete") {
        return function reactiveDelete(key: K): boolean {
          const rawKey = unwrap(key) as K;
          if (!rawTarget.has(rawKey)) return false;

          rawTarget.delete(rawKey);

          // Batch per-key bump + structural bumps so subscribers fire once.
          startBatch();
          try {
            // Bump per-key signal to undefined (signal persists for re-set).
            const s = keySignals.get(rawKey);
            if (s) {
              profileSignalWrite();
              s(undefined);
            }
            bumpOwnKeys(target);
            bumpVersionSignal(target);
          } finally {
            endBatch();
          }
          return true;
        };
      }

      // ── clear ────────────────────────────────────────────────────────────
      if (prop === "clear") {
        return function reactiveClear(): void {
          if (rawTarget.size === 0) return;

          const existingKeys = [...rawTarget.keys()];
          rawTarget.clear();

          // Batch all per-key bumps + structural bumps.
          startBatch();
          try {
            // Bump every per-key signal to undefined; keep the signal objects
            // so subscribers remain attached for subsequent re-sets.
            for (const k of existingKeys) {
              const s = keySignals.get(k);
              if (s) {
                profileSignalWrite();
                s(undefined);
              }
            }

            bumpOwnKeys(target);
            bumpVersionSignal(target);
          } finally {
            endBatch();
          }
        };
      }

      // ── forEach ──────────────────────────────────────────────────────────
      if (prop === "forEach") {
        return function reactiveForEach(
          callbackFn: (value: V, key: K, map: Map<K, V>) => void,
        ): void {
          trackOwnKeys(target);
          for (const [k, v] of rawTarget.entries()) {
            if (getCurrentSub()) {
              profileSignalRead();
              getOrCreateKeySignal(k)();
            }
            callbackFn(wrap(v) as V, wrap(k) as K, proxy);
          }
        };
      }

      // ── entries / Symbol.iterator ─────────────────────────────────────────
      if (prop === "entries" || prop === Symbol.iterator) {
        return function* reactiveEntries(): IterableIterator<[K, V]> {
          trackOwnKeys(target);
          for (const [k, v] of rawTarget.entries()) {
            if (getCurrentSub()) {
              profileSignalRead();
              getOrCreateKeySignal(k)();
            }
            yield [wrap(k) as K, wrap(v) as V];
          }
        };
      }

      // ── keys ─────────────────────────────────────────────────────────────
      if (prop === "keys") {
        return function* reactiveKeys(): IterableIterator<K> {
          trackOwnKeys(target);
          for (const [k] of rawTarget.entries()) {
            if (getCurrentSub()) {
              profileSignalRead();
              getOrCreateKeySignal(k)();
            }
            yield wrap(k) as K;
          }
        };
      }

      // ── values ───────────────────────────────────────────────────────────
      if (prop === "values") {
        return function* reactiveValues(): IterableIterator<V> {
          trackOwnKeys(target);
          for (const [k, v] of rawTarget.entries()) {
            if (getCurrentSub()) {
              profileSignalRead();
              getOrCreateKeySignal(k)();
            }
            yield wrap(v) as V;
          }
        };
      }

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

  proxy = new Proxy(rawTarget, handler);
  collectionProxyCache.set(rawTarget, proxy);
  return proxy;
}

// ---------------------------------------------------------------------------
// createReactiveSet
// ---------------------------------------------------------------------------

export function createReactiveSet<T>(rawTarget: Set<T>): Set<T> {
  if (collectionProxyCache.has(rawTarget)) {
    return collectionProxyCache.get(rawTarget) as Set<T>;
  }

  let proxy!: Set<T>;

  const handler: ProxyHandler<Set<T>> = {
    get(target, prop) {
      // ── Internal symbols ─────────────────────────────────────────────────
      if (prop === $RAW) return target;
      if (prop === $PROXY) return proxy;

      // ── size ─────────────────────────────────────────────────────────────
      if (prop === "size") {
        trackOwnKeys(target);
        return target.size;
      }

      // ── has ──────────────────────────────────────────────────────────────
      if (prop === "has") {
        return function reactiveHas(value: T): boolean {
          trackOwnKeys(target);
          return rawTarget.has(unwrap(value) as T);
        };
      }

      // ── add ──────────────────────────────────────────────────────────────
      if (prop === "add") {
        return function reactiveAdd(value: T): Set<T> {
          const rawValue = unwrap(value) as T;
          if (rawTarget.has(rawValue)) return proxy;

          rawTarget.add(rawValue);

          const nodes = getNodes(target);
          getNode(nodes, $VERSION, 0);
          getNode(nodes, $OWN_KEYS, 0);
          bumpOwnKeys(target);
          bumpVersionSignal(target);

          return proxy;
        };
      }

      // ── delete ───────────────────────────────────────────────────────────
      if (prop === "delete") {
        return function reactiveDelete(value: T): boolean {
          const rawValue = unwrap(value) as T;
          if (!rawTarget.has(rawValue)) return false;

          rawTarget.delete(rawValue);
          bumpOwnKeys(target);
          bumpVersionSignal(target);
          return true;
        };
      }

      // ── clear ────────────────────────────────────────────────────────────
      if (prop === "clear") {
        return function reactiveClear(): void {
          if (rawTarget.size === 0) return;
          rawTarget.clear();
          bumpOwnKeys(target);
          bumpVersionSignal(target);
        };
      }

      // ── forEach ──────────────────────────────────────────────────────────
      if (prop === "forEach") {
        return function reactiveForEach(
          callbackFn: (value: T, value2: T, set: Set<T>) => void,
        ): void {
          trackOwnKeys(target);
          for (const v of rawTarget.values()) {
            callbackFn(wrap(v) as T, wrap(v) as T, proxy);
          }
        };
      }

      // ── values / Symbol.iterator ──────────────────────────────────────────
      if (prop === "values" || prop === Symbol.iterator) {
        return function* reactiveValues(): IterableIterator<T> {
          trackOwnKeys(target);
          for (const v of rawTarget.values()) {
            yield wrap(v) as T;
          }
        };
      }

      // ── keys ─────────────────────────────────────────────────────────────
      // Set.prototype.keys() is identical to values() per spec.
      if (prop === "keys") {
        return function* reactiveKeys(): IterableIterator<T> {
          trackOwnKeys(target);
          for (const v of rawTarget.values()) {
            yield wrap(v) as T;
          }
        };
      }

      // ── entries ───────────────────────────────────────────────────────────
      if (prop === "entries") {
        return function* reactiveEntries(): IterableIterator<[T, T]> {
          trackOwnKeys(target);
          for (const v of rawTarget.values()) {
            yield [wrap(v) as T, wrap(v) as T];
          }
        };
      }

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

  proxy = new Proxy(rawTarget, handler);
  collectionProxyCache.set(rawTarget, proxy);
  return proxy;
}
