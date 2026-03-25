import { getCurrentSub, startBatch, endBatch } from "alien-signals";

import { $NODE, $OWN_KEYS, $PROXY, $RAW, $TRACK, $VERSION, getNode, getNodes } from "./core";
import { profileSignalRead, profileSignalSkip, profileTimeStart, profileTimeEnd } from "./profiler";
import { writeHandler } from "./write";

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

const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === "object" &&
  (value.constructor === Object || value.constructor === Array);

function wrap<T>(value: T): T {
  // Fast-path: primitives (number, string, boolean, null, undefined) skip isWrappable call
  if (typeof value !== "object" || value === null) {
    return value;
  }
  profileTimeStart("wrapTime");
  const result = isWrappable(value) ? createReactiveProxy(value) : value;
  profileTimeEnd("wrapTime");
  return result;
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
    if (arrayNodes[$VERSION]) {
      arrayNodes[$VERSION]();
    }
  }
}

const readHandler: Pick<
  ProxyHandler<object>,
  "get" | "ownKeys" | "has" | "getOwnPropertyDescriptor"
> = {
  get(target, prop, receiver) {
    if (typeof prop === "string") {
      const existingNodes = (target as any)[$NODE];
      if (existingNodes) {
        const tracked = existingNodes[prop];
        if (tracked) {
          if (!getCurrentSub()) {
            profileSignalSkip();
            return wrap((target as any)[prop]);
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
      const nodes = (target as any)[$NODE];
      return nodes?.[$VERSION] ? nodes[$VERSION]() : 0;
    }

    const value = (target as any)[prop];

    if (typeof value === "function") {
      if (Array.isArray(target)) {
        if (getCurrentSub()) {
          trackSelf(target);
        }
        if (typeof prop === "string" && ARRAY_MUTATORS.has(prop)) {
          return (...args: any[]) => {
            profileTimeStart("spliceTime");
            startBatch();
            try {
              return value.apply(receiver, args);
            } finally {
              endBatch();
              profileTimeEnd("spliceTime");
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
  if ((target as any)[$PROXY]) {
    return (target as any)[$PROXY];
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
