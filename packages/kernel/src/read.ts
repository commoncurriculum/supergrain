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
    const arrayNodes = getNodes(value);
    /* c8 ignore start -- absence of an array version signal is a no-op fast path */
    if (arrayNodes[$VERSION]) {
      arrayNodes[$VERSION]();
    }
    /* c8 ignore stop */
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
      const nodes = (target as ReactiveTagged)[$NODE];
      return nodes?.[$VERSION] ? nodes[$VERSION]() : 0;
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

  if (proxyCache.has(target)) {
    return proxyCache.get(target) as T;
  }

  if (Object.isFrozen(target)) {
    return target;
  }

  const proxy = new Proxy(target, handler);
  proxyCache.set(target, proxy);

  try {
    Object.defineProperty(target, $PROXY, { value: proxy, enumerable: false });
  } catch {
    // Fails for sealed or non-configurable objects.
  }

  return proxy as T;
}
