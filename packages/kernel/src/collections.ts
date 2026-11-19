// Map/Set methods read internal slots and throw when called on a proxy, so
// the `get` trap returns reimplementations that call the raw collection.

import { getActiveSub, startBatch, endBatch, signal } from "alien-signals";

import {
  $OWN_KEYS,
  $RAW,
  $PROXY,
  $VERSION,
  getNode,
  getNodes,
  getNodesIfExist,
  isWrappable,
  unwrap,
  type Signal,
} from "./core";
import { profileSignalRead, profileSignalSkip, profileSignalWrite } from "./profiler";
// Circular import with read.ts: safe only while neither module reads the
// other's bindings at evaluation time.
import { createReactiveProxy } from "./read";
import { readSignal } from "./render-reads";

function wrap<T>(value: T): T {
  if (!isWrappable(value)) {
    return value;
  }
  return createReactiveProxy(value) as T;
}

let BUMP = 0;

const collectionProxyCache = new WeakMap<object, object>();

function trackOwnKeys(target: object): void {
  if (getActiveSub()) {
    const nodes = getNodes(target);
    readSignal(getNode(nodes, $OWN_KEYS, 0));
  }
}

// The `!` relies on every path here that creates `nodes` also creating $OWN_KEYS.
function bumpOwnKeys(target: object): void {
  const nodes = getNodesIfExist(target);
  if (!nodes) return;
  profileSignalWrite();
  nodes[$OWN_KEYS]!(++BUMP);
}

function bumpVersionSignal(target: object): void {
  getNodesIfExist(target)?.[$VERSION]?.(++BUMP);
}

export function createReactiveMap<K, V>(rawTarget: Map<K, V>): Map<K, V> {
  if (collectionProxyCache.has(rawTarget)) {
    return collectionProxyCache.get(rawTarget) as Map<K, V>;
  }

  const keySignals = new Map<K, Signal<V | undefined>>();

  function getOrCreateKeySignal(rawKey: K): Signal<V | undefined> {
    let s = keySignals.get(rawKey);
    if (!s) {
      s = signal(rawTarget.get(rawKey)) as Signal<V | undefined>;
      keySignals.set(rawKey, s);
    }
    return s;
  }

  // Created lazily outside the trap: a closure inside it would make V8
  // allocate a context on every trap call.
  /* eslint-disable unicorn/no-useless-undefined -- init-declarations wants a value */
  let reactiveGet: ((key: K) => V | undefined) | undefined = undefined;
  let reactiveHas: ((key: K) => boolean) | undefined = undefined;
  let reactiveSet: ((key: K, value: V) => Map<K, V>) | undefined = undefined;
  let reactiveDelete: ((key: K) => boolean) | undefined = undefined;
  let reactiveClear: (() => void) | undefined = undefined;
  let reactiveForEach:
    | ((callbackFn: (value: V, key: K, map: Map<K, V>) => void) => void)
    | undefined = undefined;
  let reactiveEntries: (() => IterableIterator<[K, V]>) | undefined = undefined;
  let reactiveKeys: (() => IterableIterator<K>) | undefined = undefined;
  let reactiveValues: (() => IterableIterator<V>) | undefined = undefined;
  /* eslint-enable unicorn/no-useless-undefined */

  const handler: ProxyHandler<Map<K, V>> = {
    get(target, prop, receiver) {
      if (prop === $RAW) return target;
      if (prop === $PROXY) return receiver;
      if (prop === "size") {
        trackOwnKeys(target);
        return target.size;
      }
      if (prop === "get") {
        return (reactiveGet ??= function getMethod(key: K): V | undefined {
          const rawKey = unwrap(key);
          if (getActiveSub()) {
            profileSignalRead();
            const s = getOrCreateKeySignal(rawKey);
            const v = s() as V | undefined;
            return wrap(v);
          }
          profileSignalSkip();
          return wrap(rawTarget.get(rawKey));
        });
      }
      if (prop === "has") {
        return (reactiveHas ??= function hasMethod(key: K): boolean {
          const rawKey = unwrap(key);
          if (getActiveSub()) {
            profileSignalRead();
            readSignal(getOrCreateKeySignal(rawKey));
          } else {
            profileSignalSkip();
          }
          return rawTarget.has(rawKey);
        });
      }
      if (prop === "set") {
        return (reactiveSet ??= function setMethod(key: K, value: V): Map<K, V> {
          const rawKey = unwrap(key);
          const rawValue = unwrap(value);
          const isNew = !rawTarget.has(rawKey);
          const oldRawValue = rawTarget.get(rawKey);

          rawTarget.set(rawKey, rawValue);

          const didChange = unwrap(oldRawValue) !== unwrap(rawValue);

          if (isNew) {
            startBatch();
            try {
              const s = keySignals.get(rawKey);
              if (s) {
                profileSignalWrite();
                s(rawValue);
              }
              const nodes = getNodes(rawTarget);
              getNode(nodes, $VERSION, 0);
              getNode(nodes, $OWN_KEYS, 0);
              bumpOwnKeys(rawTarget);
              bumpVersionSignal(rawTarget);
            } finally {
              endBatch();
            }
          } else if (didChange) {
            const s = keySignals.get(rawKey);
            if (s) {
              profileSignalWrite();
              s(rawValue);
            }
          }

          return proxy;
        });
      }
      if (prop === "delete") {
        return (reactiveDelete ??= function deleteMethod(key: K): boolean {
          const rawKey = unwrap(key);
          if (!rawTarget.has(rawKey)) return false;

          rawTarget.delete(rawKey);

          startBatch();
          try {
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
        });
      }
      if (prop === "clear") {
        return (reactiveClear ??= function clearMethod(): void {
          if (rawTarget.size === 0) return;

          const existingKeys = [...rawTarget.keys()];
          rawTarget.clear();

          startBatch();
          try {
            for (const k of existingKeys) {
              const s = keySignals.get(k);
              if (s) {
                profileSignalWrite();
                s(void 0 as V | undefined);
              }
            }

            bumpOwnKeys(rawTarget);
            bumpVersionSignal(rawTarget);
          } finally {
            endBatch();
          }
        });
      }
      if (prop === "forEach") {
        return (reactiveForEach ??= function forEachMethod(
          callbackFn: (value: V, key: K, map: Map<K, V>) => void,
        ): void {
          trackOwnKeys(rawTarget);
          for (const [k, v] of rawTarget.entries()) {
            if (getActiveSub()) {
              profileSignalRead();
              readSignal(getOrCreateKeySignal(k));
            }
            callbackFn(wrap(v), wrap(k), proxy);
          }
        });
      }
      if (prop === "entries" || prop === Symbol.iterator) {
        return (reactiveEntries ??= function* entriesMethod(): IterableIterator<[K, V]> {
          trackOwnKeys(rawTarget);
          for (const [k, v] of rawTarget.entries()) {
            if (getActiveSub()) {
              profileSignalRead();
              readSignal(getOrCreateKeySignal(k));
            }
            yield [wrap(k), wrap(v)];
          }
        });
      }
      // Must not read per-key signals, or key-only iteration reruns on value changes.
      if (prop === "keys") {
        return (reactiveKeys ??= function* keysMethod(): IterableIterator<K> {
          trackOwnKeys(rawTarget);
          for (const k of rawTarget.keys()) {
            yield wrap(k);
          }
        });
      }
      if (prop === "values") {
        return (reactiveValues ??= function* valuesMethod(): IterableIterator<V> {
          trackOwnKeys(rawTarget);
          for (const [k, v] of rawTarget.entries()) {
            if (getActiveSub()) {
              profileSignalRead();
              readSignal(getOrCreateKeySignal(k));
            }
            yield wrap(v);
          }
        });
      }
      if (prop === Symbol.toStringTag) return "Map";
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
  collectionProxyCache.set(rawTarget, proxy);
  return proxy;
}

export function createReactiveSet<T>(rawTarget: Set<T>): Set<T> {
  if (collectionProxyCache.has(rawTarget)) {
    return collectionProxyCache.get(rawTarget) as Set<T>;
  }

  /* eslint-disable unicorn/no-useless-undefined -- init-declarations wants a value */
  let reactiveHas: ((value: T) => boolean) | undefined = undefined;
  let reactiveAdd: ((value: T) => Set<T>) | undefined = undefined;
  let reactiveDelete: ((value: T) => boolean) | undefined = undefined;
  let reactiveClear: (() => void) | undefined = undefined;
  let reactiveForEach:
    | ((callbackFn: (value: T, value2: T, set: Set<T>) => void) => void)
    | undefined = undefined;
  let reactiveValues: (() => IterableIterator<T>) | undefined = undefined;
  let reactiveKeys: (() => IterableIterator<T>) | undefined = undefined;
  let reactiveEntries: (() => IterableIterator<[T, T]>) | undefined = undefined;
  /* eslint-enable unicorn/no-useless-undefined */

  const handler: ProxyHandler<Set<T>> = {
    get(target, prop, receiver) {
      if (prop === $RAW) return target;
      if (prop === $PROXY) return receiver;
      if (prop === "size") {
        trackOwnKeys(target);
        return target.size;
      }
      if (prop === "has") {
        return (reactiveHas ??= function hasMethod(value: T): boolean {
          trackOwnKeys(rawTarget);
          return rawTarget.has(unwrap(value));
        });
      }
      if (prop === "add") {
        return (reactiveAdd ??= function addMethod(value: T): Set<T> {
          const rawValue = unwrap(value);
          if (rawTarget.has(rawValue)) return proxy;

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

          return proxy;
        });
      }
      if (prop === "delete") {
        return (reactiveDelete ??= function deleteMethod(value: T): boolean {
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
        });
      }
      if (prop === "clear") {
        return (reactiveClear ??= function clearMethod(): void {
          if (rawTarget.size === 0) return;
          rawTarget.clear();
          startBatch();
          try {
            bumpOwnKeys(rawTarget);
            bumpVersionSignal(rawTarget);
          } finally {
            endBatch();
          }
        });
      }
      if (prop === "forEach") {
        return (reactiveForEach ??= function forEachMethod(
          callbackFn: (value: T, value2: T, set: Set<T>) => void,
        ): void {
          trackOwnKeys(rawTarget);
          for (const v of rawTarget.values()) {
            callbackFn(wrap(v), wrap(v), proxy);
          }
        });
      }
      if (prop === "values" || prop === Symbol.iterator) {
        return (reactiveValues ??= function* valuesMethod(): IterableIterator<T> {
          trackOwnKeys(rawTarget);
          for (const v of rawTarget.values()) {
            yield wrap(v);
          }
        });
      }
      if (prop === "keys") {
        return (reactiveKeys ??= function* keysMethod(): IterableIterator<T> {
          trackOwnKeys(rawTarget);
          for (const v of rawTarget.values()) {
            yield wrap(v);
          }
        });
      }
      if (prop === "entries") {
        return (reactiveEntries ??= function* entriesMethod(): IterableIterator<[T, T]> {
          trackOwnKeys(rawTarget);
          for (const v of rawTarget.values()) {
            yield [wrap(v), wrap(v)];
          }
        });
      }
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
  collectionProxyCache.set(rawTarget, proxy);
  return proxy;
}
