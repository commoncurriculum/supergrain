import { getCurrentSub, startBatch, endBatch } from "alien-signals";

import { createReactiveMap, createReactiveSet } from "./collections";
import {
  $MUTATORS,
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

// Null-prototype object: O(1) property lookup with the same semantics as
// Set.has() but without the method-call overhead and with a simpler,
// more predictable shape for V8.
const ARRAY_MUTATORS: Record<string, true> = Object.assign(
  Object.create(null) as Record<string, true>,
  {
    push: true,
    pop: true,
    shift: true,
    unshift: true,
    splice: true,
    sort: true,
    reverse: true,
    fill: true,
    copyWithin: true,
  },
);

// Fallback proxy cache for sealed / non-extensible objects where
// Object.defineProperty($PROXY) cannot be stored on the target.
// Populated only for that rare case — stays nearly empty in practice.
const proxyCache = new WeakMap<object, object>();

function wrap<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return isWrappable(value) ? createReactiveProxy(value) : value;
}

function trackSelf(target: object): void {
  if (getCurrentSub()) {
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
  if (Array.isArray(value) && getCurrentSub()) {
    const arrayNodes = getNodes(value);
    /* c8 ignore start -- absence of an array version signal is a no-op fast path */
    if (arrayNodes[$VERSION]) {
      arrayNodes[$VERSION]();
    }
    /* c8 ignore stop */
  }
}

// Create (or retrieve) the per-array mutator wrapper cache stored as a hidden
// $MUTATORS property on the raw array. Extracted to keep the proxy get handler
// shallow enough to satisfy the max-depth lint rule.
function getMutatorCache(
  target: object,
): Record<string, (...args: Array<unknown>) => unknown> {
  let cache = (target as any)[$MUTATORS] as
    | Record<string, (...args: Array<unknown>) => unknown>
    | undefined;
  if (!cache) {
    cache = Object.create(null) as Record<string, (...args: Array<unknown>) => unknown>;
    try {
      Object.defineProperty(target, $MUTATORS, { value: cache, enumerable: false });
    } catch {
      // Non-extensible array: wrapper recreated on each access (correct if
      // uncached). Proxied arrays are extensible by default; this is rare.
    }
  }
  return cache;
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
          if (!getCurrentSub()) {
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
        if (getCurrentSub()) {
          trackSelf(target);
        }
        if (typeof prop === "string" && ARRAY_MUTATORS[prop]) {
          // Per-array mutator wrapper cache stored as a hidden $MUTATORS property
          // on the raw array target — avoids a module-level WeakMap lookup and
          // keeps the data co-located with the object that owns it (intrusive
          // pattern). Falls back to recreating the wrapper for non-extensible
          // arrays (see getMutatorCache).
          const cache = getMutatorCache(target);
          let wrapper = cache[prop];
          if (!wrapper) {
            const method = value as (...a: Array<unknown>) => unknown;
            // `receiver` is the stable proxy (one per raw target via $PROXY).
            const proxy = receiver;
            wrapper = (...args: Array<unknown>) => {
              startBatch();
              try {
                return method.apply(proxy, args);
              } finally {
                endBatch();
              }
            };
            cache[prop] = wrapper;
          }
          return wrapper;
        }
      }
      return value;
    }

    if (!getCurrentSub()) {
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

  // Primary proxy cache: $PROXY is stored directly on the raw target as a
  // hidden property (intrusive pattern — same as alien-signals' approach of
  // embedding tracking metadata on the tracked object). This is faster than a
  // module-level WeakMap lookup and covers plain objects, arrays, Maps, and
  // Sets once they have been proxied. Checking here, before the instanceof
  // tests, also lets already-proxied Maps/Sets skip those checks entirely.
  const cached = (target as ReactiveTagged)[$PROXY];
  if (cached) return cached as T;

  if (target instanceof Map) {
    return createReactiveMap(target as Map<unknown, unknown>) as unknown as T;
  }
  if (target instanceof Set) {
    return createReactiveSet(target as Set<unknown>) as unknown as T;
  }

  // Fallback cache for sealed / non-extensible objects where
  // Object.defineProperty($PROXY) cannot be stored on the target.
  if (proxyCache.has(target)) {
    return proxyCache.get(target) as T;
  }

  if (Object.isFrozen(target)) {
    return target;
  }

  const proxy = new Proxy(target, handler);

  // Store the proxy on the target itself (fast path for all future lookups).
  // Only fall back to the module-level WeakMap when that fails (sealed objects).
  try {
    Object.defineProperty(target, $PROXY, { value: proxy, enumerable: false });
  } catch {
    proxyCache.set(target, proxy);
  }

  return proxy as T;
}
