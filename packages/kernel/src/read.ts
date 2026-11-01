import { getActiveSub } from "alien-signals";

import { ARRAY_METHODS, type NativeArrayMethod } from "./array-methods";
import { createReactiveMap, createReactiveSet } from "./collections";
import {
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $TRACK,
  $VERSION,
  getNode,
  getNodes,
  isWrappable,
  type ReactiveTagged,
} from "./core";
import { profileSignalRead, profileSignalSkip } from "./profiler";
import { writeHandler } from "./write";

const proxyCache = new WeakMap<object, object>();

// The subscriber that `readWholeObjects` is running, if any.
let wholeObjectReader: unknown = null;

/**
 * Run `fn` so that the active subscriber tracks each plain object it reads
 * as a whole: one subscription to the object's version, which every write
 * to it bumps, instead of one signal per field read. It reruns more often
 * (on writes to fields it never read), but costs far less memory. Fields
 * that already have a signal are still tracked per field. Computeds that
 * `fn` reads track as usual.
 *
 * Only for a reader whose result can't tell the extra reruns apart, such as
 * a list row that keeps its previous outcome when nothing moved.
 */
export function readWholeObjects<R>(fn: () => R): R {
  const previous = wholeObjectReader;
  wholeObjectReader = getActiveSub();
  try {
    return fn();
  } finally {
    wholeObjectReader = previous;
  }
}

export function wrap<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return isWrappable(value) ? createReactiveProxy(value) : value;
}

function trackSelf(target: object): void {
  if (getActiveSub()) {
    const nodes = getNodes(target);
    const ownKeysSignal = getNode(nodes, $OWN_KEYS, 0);
    ownKeysSignal();
  }
}

// When returning an array with an active subscriber, subscribe
// to the array's version signal so any mutation (splice, push,
// swap) triggers a re-render. Version is cheaper than ownKeys
// because alien-signals deduplicates dirty-marking.
function trackArrayVersion(value: unknown): void {
  if (Array.isArray(value) && getActiveSub()) {
    getNode(getNodes(value), $VERSION, 0)();
  }
}

const readHandler: Pick<
  ProxyHandler<object>,
  "get" | "ownKeys" | "has" | "getOwnPropertyDescriptor"
> = {
  get(target, prop, receiver) {
    if (typeof prop === "string") {
      const existingNodes = (target as ReactiveTagged)[$NODE];
      if (existingNodes) {
        const tracked = existingNodes[prop];
        if (tracked) {
          if (!getActiveSub()) {
            profileSignalSkip();
            return wrap((target as Record<string, unknown>)[prop]);
          }
          profileSignalRead();
          const value = tracked();
          if (isWrappable(value)) {
            const proxy = createReactiveProxy(value);
            trackArrayVersion(value);
            return proxy;
          }
          return value;
        }
      }
    }

    if (prop === $RAW) {
      return target;
    }
    if (prop === $PROXY) {
      return receiver;
    }
    if (prop === $TRACK) {
      trackSelf(target);
      return receiver;
    }
    if (prop === $VERSION) {
      return getNode(getNodes(target), $VERSION, 0)();
    }

    // Direct bracket access — Reflect.get is ~22x slower in this hot handler
    // and we don't need its receiver-binding behavior. See
    // notes/architecture/proxy-optimization-trade-offs.md.
    const value = (target as Record<PropertyKey, unknown>)[prop];

    if (typeof value === "function") {
      if (Array.isArray(target)) {
        if (getActiveSub()) {
          trackSelf(target);
        }
        // Keep this branch to one lookup and one closure: the handler's shape
        // is load-bearing (notes/failed-approaches/fast-push-bypass-proxy.md).
        const method = ARRAY_METHODS.get(prop);
        if (method) {
          return (...args: Array<unknown>) =>
            method(target, receiver, value as NativeArrayMethod, args);
        }
      }
      return value;
    }

    if (!getActiveSub()) {
      profileSignalSkip();
      return wrap(value);
    }

    profileSignalRead();
    const nodes = getNodes(target);
    // A whole-object reader subscribes to the object's version, which every
    // write to it bumps, instead of making a signal for each field. Arrays
    // are tracked per index as usual: replacing an element doesn't bump
    // their version.
    if (
      wholeObjectReader !== null &&
      wholeObjectReader === getActiveSub() &&
      !Array.isArray(target)
    ) {
      getNode(nodes, $VERSION, 0)();
      return wrap(value);
    }
    const node = getNode(nodes, prop, value);
    return wrap(node());
  },

  ownKeys(target) {
    trackSelf(target);
    return Reflect.ownKeys(target);
  },

  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $NODE || property === $VERSION) {
      return true;
    }
    trackSelf(target);
    return Reflect.has(target, property);
  },

  getOwnPropertyDescriptor(target, property) {
    const desc = Object.getOwnPropertyDescriptor(target, property);
    if (desc && !desc.configurable) {
      return desc;
    }
    trackSelf(target);
    return desc;
  },
};

const handler: ProxyHandler<object> = {
  ...readHandler,
  ...writeHandler,
};

export function createReactiveProxy<T extends object>(target: T): T {
  // Idempotency: if `target` is itself a reactive proxy (object, Map, or Set),
  // it responds to $RAW with its raw target — return the proxy unchanged
  // instead of wrapping again. Without this, passing a reactive Map back in
  // would build a proxy-of-a-proxy because the Map check below also matches.
  if ((target as ReactiveTagged)[$RAW]) {
    return target;
  }

  if (target instanceof Map) {
    return createReactiveMap(target as Map<unknown, unknown>) as unknown as T;
  }
  if (target instanceof Set) {
    return createReactiveSet(target as Set<unknown>) as unknown as T;
  }

  const cached = (target as ReactiveTagged)[$PROXY];
  if (cached) return cached as T;

  // The proxy lives on its target. Only a target that can't take a new
  // property keeps it in a WeakMap, which costs more to fill and to collect.
  if (Object.isExtensible(target)) {
    const proxy = new Proxy(target, handler);
    Object.defineProperty(target, $PROXY, { value: proxy });
    return proxy as T;
  }
  if (Object.isFrozen(target)) {
    return target;
  }
  let proxy = proxyCache.get(target);
  if (proxy === undefined) {
    proxy = new Proxy(target, handler);
    proxyCache.set(target, proxy);
  }
  return proxy as T;
}
