import { getCurrentSub, startBatch, endBatch } from "alien-signals";

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

// Array methods that mutate the array internally do multiple proxy `set`
// operations (e.g., `push` does `arr[len] = x; arr.length += 1`). Without
// batching, each internal write fires its own propagate/drain cycle, and
// synchronous effects (`useSignalEffect`, raw `effect()`) observe partial
// states between sub-operations — for example, length updated before the
// new element, or vice versa. Wrapping these methods in `startBatch` /
// `endBatch` coalesces all internal writes into a single notification.
//
// The list is enumerated rather than "wrap all array method calls" because
// the proxy `get` handler is the hottest function in the library (every
// property read goes through it), and V8 deoptimizes the entire handler when
// its shape changes. See `notes/failed-approaches/fast-push-bypass-proxy.md`
// for an attempt that regressed unrelated benchmarks 13-27% by adding a
// single conditional branch here.
//
// Trade-off: any future ES mutator (e.g., a hypothetical
// `Array.prototype.frobnicate`) won't be batched until added to this list.
// Synchronous effects observing arrays mutated via the new method would see
// partial states. React renderers via `tracked()` are unaffected (React
// batches `forceUpdate` calls).
const ARRAY_MUTATORS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

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
            return wrap(Reflect.get(target, prop));
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

    const value = Reflect.get(target, prop);

    if (typeof value === "function") {
      if (Array.isArray(target)) {
        if (getCurrentSub()) {
          trackSelf(target);
        }
        if (typeof prop === "string" && ARRAY_MUTATORS.has(prop)) {
          return (...args: Array<unknown>) => {
            startBatch();
            try {
              return (value as (...a: Array<unknown>) => unknown).apply(receiver, args);
            } finally {
              endBatch();
            }
          };
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

  if (target instanceof Map) {
    return createReactiveMap(target as Map<unknown, unknown>) as unknown as T;
  }
  if (target instanceof Set) {
    return createReactiveSet(target as Set<unknown>) as unknown as T;
  }

  if ((target as ReactiveTagged)[$PROXY]) {
    return (target as ReactiveTagged)[$PROXY] as T;
  }

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
