import { getCurrentSub } from 'alien-signals'
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
} from './core'
import { writeHandler } from './write'

const proxyCache = new WeakMap<object, object>()

const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}

function trackSelf(target: object): void {
  if (getCurrentSub()) {
    const nodes = getNodes(target)
    const ownKeysSignal = getNode(nodes, $OWN_KEYS, 0)
    ownKeysSignal()
  }
}

const readHandler: Pick<
  ProxyHandler<object>,
  'get' | 'ownKeys' | 'has' | 'getOwnPropertyDescriptor'
> = {
  get(target, prop, receiver) {
    if (typeof prop === 'string') {
      const existingNodes = (target as any)[$NODE]
      if (existingNodes) {
        const tracked = existingNodes[prop]
        if (tracked) {
          const value = tracked()
          return isWrappable(value) ? createReactiveProxy(value) : value
        }
      }
    }

    if (prop === $RAW) return target
    if (prop === $PROXY) return receiver
    if (prop === $TRACK) {
      trackSelf(target)
      return receiver
    }
    if (prop === $VERSION) return (target as any)[$VERSION] || 0

    const value = (target as any)[prop]

    if (typeof value === 'function') {
      if (Array.isArray(target) && prop === Symbol.iterator) trackSelf(target)
      return value
    }

    if (!getCurrentSub()) {
      return wrap(value)
    }

    const nodes = getNodes(target)
    const node = getNode(nodes, prop, value)
    return wrap(node())
  },

  ownKeys(target) {
    trackSelf(target)
    return Reflect.ownKeys(target)
  },

  has(target, property) {
    if (
      property === $RAW ||
      property === $PROXY ||
      property === $NODE ||
      property === $VERSION
    ) {
      return true
    }
    trackSelf(target)
    return Reflect.has(target, property)
  },

  getOwnPropertyDescriptor(target, property) {
    const desc = Object.getOwnPropertyDescriptor(target, property)
    if (desc && !desc.configurable) {
      return desc
    }
    trackSelf(target)
    return desc
  },
}

const handler: ProxyHandler<object> = {
  ...readHandler,
  ...writeHandler,
}

export function createReactiveProxy<T extends object>(target: T): T {
  if ((target as any)[$PROXY]) {
    return (target as any)[$PROXY]
  }

  if (proxyCache.has(target)) {
    return proxyCache.get(target) as T
  }

  if (Object.isFrozen(target)) {
    return target
  }

  const proxy = new Proxy(target, handler)
  proxyCache.set(target, proxy)

  try {
    Object.defineProperty(target, $PROXY, { value: proxy, enumerable: false })
  } catch {
    // Fails for frozen objects, which is expected.
  }

  return proxy as T
}

export function defineSignalGetter(proto: object, key: string): void {
  Object.defineProperty(proto, key, {
    get() {
      return this._n[key]()
    },
    enumerable: true,
    configurable: true,
  })
}

const viewProtoCache = new Map<string, object>()
const viewCache = new WeakMap<object, object>()

export function createView<T extends object>(target: T): Readonly<T> {
  const raw = unwrap(target) as any

  const cached = viewCache.get(raw)
  if (cached) return cached as T

  const keys = Object.keys(raw)
  const cacheKey = keys.join('\0')

  const nodes = getNodes(raw)
  for (const key of keys) {
    if (!nodes[key]) getNode(nodes, key, raw[key])
  }

  let proto = viewProtoCache.get(cacheKey)
  if (!proto) {
    proto = {}
    for (const key of keys) {
      defineSignalGetter(proto, key)
    }
    viewProtoCache.set(cacheKey, proto)
  }

  const view = Object.create(proto)
  view._n = nodes
  viewCache.set(raw, view)

  return view as T
}
