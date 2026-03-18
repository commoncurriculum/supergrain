import { getCurrentSub } from "alien-signals";
import {
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $TRACK,
  $VERSION,
  getNode,
  getNodes,
  unwrap,
} from "./core";
import { writeHandler } from "./write";

const proxyCache = new WeakMap<object, object>();
const signalGetterCache = new Map<string, (this: any) => any>();

const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === "object" &&
  (value.constructor === Object || value.constructor === Array);

function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value;
}

function trackSelf(target: object): void {
  if (getCurrentSub()) {
    const nodes = getNodes(target);
    const ownKeysSignal = getNode(nodes, $OWN_KEYS, 0);
    ownKeysSignal();
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
          const value = tracked();
          if (isWrappable(value)) {
            const proxy = createReactiveProxy(value);
            // When returning an array with an active subscriber, subscribe
            // to the array's version signal so any mutation (splice, push,
            // swap) triggers a re-render. Version is cheaper than ownKeys
            // because alien-signals deduplicates dirty-marking.
            if (Array.isArray(value) && getCurrentSub()) {
              const arrayNodes = getNodes(value);
              if (arrayNodes[$VERSION]) arrayNodes[$VERSION]();
            }
            return proxy;
          }
          return value;
        }
      }
    }

    if (prop === $RAW) return target;
    if (prop === $PROXY) return receiver;
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
      if (Array.isArray(target) && getCurrentSub()) trackSelf(target);
      return value;
    }

    if (!getCurrentSub()) {
      return wrap(value);
    }

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
    // Fails for frozen objects, which is expected.
  }

  return proxy as T;
}

export function getSignalGetter(key: string): (this: any) => any {
  const cached = signalGetterCache.get(key);
  if (cached) return cached;

  const getter = function (this: any) {
    const value = this._n[key]();
    return isWrappable(value) ? createReactiveProxy(value) : value;
  };

  signalGetterCache.set(key, getter);
  return getter;
}

export function defineSignalGetter(proto: object, key: string): void {
  Object.defineProperty(proto, key, {
    get: getSignalGetter(key),
    enumerable: true,
    configurable: true,
  });
}

const viewCache = new WeakMap<object, object>();

// Compiled views keep their signal table on a hidden slot so the public object
// surface still behaves like a normal readonly object.
export function attachViewNodes(target: object, nodes: object): void {
  Object.defineProperty(target, "_n", {
    value: nodes,
    enumerable: false,
    configurable: true,
  });
}

export function createView<T extends object>(target: T): Readonly<T> {
  const raw = unwrap(target) as any;

  const cached = viewCache.get(raw);
  if (cached) return cached as T;

  const keys = Object.keys(raw);

  const nodes = getNodes(raw);
  for (const key of keys) {
    if (!nodes[key]) getNode(nodes, key, raw[key]);
  }

  const view = {};
  attachViewNodes(view, nodes);
  for (const key of keys) {
    defineSignalGetter(view, key);
  }
  Object.freeze(view);
  viewCache.set(raw, view);

  return view as T;
}
