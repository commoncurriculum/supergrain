import { getActiveSub } from "alien-signals";

import { ARRAY_METHODS } from "./array-methods";
import { createReactiveMap, createReactiveSet } from "./collections";
import {
  $HAS_FIELD_NODES,
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $TRACK,
  $VERSION,
  defineHidden,
  getNode,
  getNodes,
  isWrappable,
  type DataNodes,
  type ReactiveTagged,
} from "./core";
import { profileSignalRead, profileSignalSkip } from "./profiler";
import { readSignal } from "./render-reads";
import { writeHandler } from "./write";

const proxyCache = new WeakMap<object, object>();

let wholeObject: object | null = null;
let wholeObjectReader: ReturnType<typeof getActiveSub> | null = null;

// The subscriber reruns on writes to fields it never read: use only where
// those extra reruns can't change the result.
export function readWholeObject<A, B, R>(target: object, fn: (a: A, b: B) => R, a: A, b: B): R {
  // Replacing an array element doesn't bump its version: track per index.
  if (Array.isArray(target)) return fn(a, b);
  const previous = wholeObject;
  const previousReader = wholeObjectReader;
  wholeObject = target;
  wholeObjectReader = getActiveSub();
  try {
    return fn(a, b);
  } finally {
    wholeObject = previous;
    wholeObjectReader = previousReader;
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
    readSignal(ownKeysSignal);
  }
}

// Version rather than ownKeys: alien-signals dedupes its dirty-marking.
function trackArrayVersion(value: unknown): void {
  if (Array.isArray(value) && getActiveSub()) {
    readSignal(getNode(getNodes(value), $VERSION, 0));
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
          const value = readSignal(tracked);
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
      if (Array.isArray(target) && getActiveSub()) {
        readSignal(getNode(getNodes(target), "length", target.length));
      }
      return receiver;
    }
    if (prop === $VERSION) {
      return readSignal(getNode(getNodes(target), $VERSION, 0));
    }

    // Reflect.get is ~22x slower here (notes/architecture/proxy-optimization-trade-offs.md).
    const value = (target as Record<PropertyKey, unknown>)[prop];

    if (typeof value === "function") {
      if (Array.isArray(target)) {
        if (getActiveSub()) {
          trackSelf(target);
        }
        // Keep this branch to one lookup: the handler's shape is load-bearing
        // (notes/failed-approaches/fast-push-bypass-proxy.md).
        const method = ARRAY_METHODS.get(prop);
        if (method) return method;
      }
      return value;
    }

    if (!getActiveSub()) {
      profileSignalSkip();
      return wrap(value);
    }

    profileSignalRead();
    const nodes = getNodes(target);
    if (target === wholeObject && wholeObjectReader === getActiveSub()) {
      readSignal(getNode(nodes, $VERSION, 0));
      return wrap(value);
    }
    const node = nodes[prop] ?? fieldNode(target, nodes, prop, value);
    return wrap(readSignal(node));
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
  // Must precede the Map/Set checks, or a reactive Map gets proxied twice.
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

  if (Object.isFrozen(target)) {
    return target;
  }
  let proxy = proxyCache.get(target);
  if (proxy === undefined) {
    proxy = new Proxy(target, handler);
    // WeakMap only as fallback: it costs more to fill and collect.
    if (!defineHidden(target, $PROXY, proxy)) proxyCache.set(target, proxy);
  }
  return proxy as T;
}

function fieldNode(target: object, nodes: DataNodes, prop: PropertyKey, value: unknown) {
  const node = getNode(nodes, prop, value);
  if (prop !== "length" && Array.isArray(target)) nodes[$HAS_FIELD_NODES] = node;
  return node;
}
