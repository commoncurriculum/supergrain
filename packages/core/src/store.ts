import { signal, getCurrentSub, startBatch, endBatch } from 'alien-signals'

// A reactive signal type, compatible with alien-signals but with an
// optional writer property for SolidJS compatibility.
export type Signal<T> = {
  (): T
  (value: T): void
  $?: (value: T) => void // Writer for SolidJS compatibility
}

// Internal symbols to store metadata on reactive objects without polluting them.
const $NODE = Symbol('store-node') // Holds the signals for each property.
const $PROXY = Symbol('store-proxy') // Points from the original object to its proxy.
const $TRACK = Symbol('store-track') // A symbol to trigger tracking of the whole object.

// Caches for performance optimization.
const proxyCache = new WeakMap<object, object>() // Caches proxies for given objects.
const descriptorCache = new WeakMap<
  object,
  Map<PropertyKey, PropertyDescriptor | null>
>() // Caches property descriptors.

/**
 * Checks if a value is a plain object or array that can be wrapped in a proxy.
 */
const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

// Type for the internal signal storage object.
type DataNodes = Record<PropertyKey, Signal<any>>

/**
 * Retrieves a cached property descriptor to avoid repeated lookups.
 */
function getCachedDescriptor(
  target: object,
  property: PropertyKey
): PropertyDescriptor | null | undefined {
  let cache = descriptorCache.get(target)
  if (!cache) {
    cache = new Map()
    descriptorCache.set(target, cache)
  }

  if (cache.has(property)) {
    return cache.get(property)
  }

  const desc = Object.getOwnPropertyDescriptor(target, property)
  cache.set(property, desc || null)
  return desc
}

/**
 * Gets or creates the storage object for signals on a target object.
 */
function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = Object.create(null)
    try {
      Object.defineProperty(target, $NODE, { value: nodes, enumerable: false })
    } catch {
      // Object might be frozen. The WeakMap cache will still work.
    }
  }
  return nodes
}

/**
 * Gets or creates a signal for a specific property on a nodes object.
 */
function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  if (nodes[property]) {
    return nodes[property]
  }

  const newSignal = signal(value) as Signal<any>
  // SolidJS compatibility: store writer on the reader signal.
  newSignal.$ = (v: any) => newSignal(v)
  nodes[property] = newSignal
  return newSignal
}

/**
 * Wraps a value in a reactive proxy if it's wrappable.
 */
function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}

/**
 * Unwraps a proxy to return the original, raw object.
 */
export function unwrap<T>(value: T): T {
  if (!isWrappable(value)) {
    return value
  }
  const unwrapped = (value as any)[$PROXY] ? (value as any).value : value
  return unwrapped
}

/**
 * Sets a property on the target, updating the corresponding signal.
 */
function setProperty(
  target: any,
  property: PropertyKey,
  value: any,
  isDelete = false
): void {
  const hadKey = Object.prototype.hasOwnProperty.call(target, property)
  const oldValue = target[property]

  if (isDelete) {
    delete target[property]
  } else {
    target[property] = value
  }

  const nodes = (target as any)[$NODE] as DataNodes | undefined
  if (nodes) {
    const node = nodes[property]
    if (node && oldValue !== value) {
      node(isDelete ? undefined : value)
    }

    // If an array's length changes, update its signal.
    if (Array.isArray(target) && property !== 'length') {
      const lengthNode = nodes['length']
      if (lengthNode && target.length !== (oldValue as any)?.length) {
        lengthNode(target.length)
      }
    }
  }

  // If a key was added or removed, trigger ownKeys signal for shape changes.
  const wasAdded = !hadKey && !isDelete
  const wasDeleted = hadKey && isDelete
  if (wasAdded || wasDeleted) {
    const ownKeysSignal = nodes?.[Symbol.for('ownKeys')]
    if (ownKeysSignal) {
      ownKeysSignal(ownKeysSignal() + 1)
    }
  }
}

/**
 * Creates a dependency on the object's shape (e.g., for Object.keys).
 */
function trackSelf(target: object): void {
  if (!getCurrentSub()) return
  const nodes = getNodes(target)
  const ownKeysSignal = getNode(nodes, Symbol.for('ownKeys'), 0)
  ownKeysSignal() // Read to subscribe.
}

/**
 * A specialized handler for array mutation methods to ensure reactivity.
 */
const arrayMethodHandler: Record<
  string,
  (target: any[], nodes: DataNodes, method: Function, args: any[]) => any
> = {
  // Methods that change length and values
  push(target, nodes, method, args) {
    const result = method.apply(target, args)
    if (nodes['length']) (nodes['length'] as Signal<number>)(target.length)
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) (ownKeysSignal as Signal<number>)(ownKeysSignal() + 1)
    return result
  },
  pop(target, nodes, method, args) {
    const oldLength = target.length
    const result = method.apply(target, args)
    if (nodes['length'] && target.length !== oldLength) {
      ;(nodes['length'] as Signal<number>)(target.length)
    }
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) (ownKeysSignal as Signal<number>)(ownKeysSignal() + 1)
    return result
  },
  shift(target, nodes, method, args) {
    const oldLength = target.length
    const result = method.apply(target, args)
    if (nodes) {
      for (let i = 0; i < oldLength; i++) {
        if (nodes[i]) nodes[i]?.(target[i])
      }
      if (nodes['length']) (nodes['length'] as Signal<number>)(target.length)
    }
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) (ownKeysSignal as Signal<number>)(ownKeysSignal() + 1)
    return result
  },
  unshift(target, nodes, method, args) {
    const oldLength = target.length
    method.apply(target, args)
    if (nodes) {
      for (let i = 0; i < target.length; i++) {
        if (nodes[i]) nodes[i]?.(target[i])
      }
      if (nodes['length'] && target.length !== oldLength) {
        ;(nodes['length'] as Signal<number>)(target.length)
      }
    }
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) (ownKeysSignal as Signal<number>)(ownKeysSignal() + 1)
    return target.length
  },
  splice(target, nodes, method, args) {
    const oldLength = target.length
    const result = method.apply(target, args)
    if (nodes) {
      const newLength = target.length
      const maxLength = Math.max(oldLength, newLength)
      for (let i = 0; i < maxLength; i++) {
        if (nodes[i]) nodes[i]?.(target[i])
      }
      if (nodes['length'] && oldLength !== newLength) {
        ;(nodes['length'] as Signal<number>)(newLength)
      }
    }
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) (ownKeysSignal as Signal<number>)(ownKeysSignal() + 1)
    return result
  },
  // Methods that only reorder values
  sort(target, nodes, method, args) {
    const result = method.apply(target, args)
    for (let i = 0; i < target.length; i++) {
      const node = nodes[i]
      if (node) node?.(target[i])
    }
    return result
  },
  reverse(target, nodes, method, args) {
    const result = method.apply(target, args)
    for (let i = 0; i < target.length; i++) {
      const node = nodes[i]
      if (node) node?.(target[i])
    }
    return result
  },
}

/**
 * The core Proxy handler that intercepts property access and mutations.
 */
const handler: ProxyHandler<object> = {
  get(target, property, receiver) {
    if (property === $PROXY) return receiver
    if (property === $TRACK) {
      trackSelf(target)
      return receiver
    }
    if (property === $NODE) return (target as any)[$NODE]

    if (!getCurrentSub()) {
      const value = Reflect.get(target, property, receiver)
      return isWrappable(value) ? wrap(value) : value
    }

    if (Array.isArray(target) && property in arrayMethodHandler) {
      const method = Array.prototype[property as keyof typeof Array.prototype]
      const handlerFn = arrayMethodHandler[property as string]
      return function (...args: any[]) {
        let result
        startBatch()
        try {
          const nodes = (target as any)[$NODE]
          result = handlerFn!(target, nodes, method as Function, args)
        } finally {
          endBatch()
        }
        return result
      }
    }

    const nodes = (target as any)[$NODE] as DataNodes | undefined
    const nodeSignal = nodes?.[property]
    if (nodeSignal) {
      const value = nodeSignal()
      return wrap(value)
    }

    const value = Reflect.get(target, property, receiver)

    if (typeof value === 'function') {
      return value
    }

    const desc = getCachedDescriptor(target, property)
    if (!desc || (!desc.get && desc.writable)) {
      const nodes = getNodes(target)
      const newSignal = getNode(nodes, property, value)
      const trackedValue = newSignal()
      return wrap(trackedValue)
    }

    return wrap(value)
  },

  set(target, property, value) {
    startBatch()
    try {
      setProperty(target, property, unwrap(value))
    } finally {
      endBatch()
    }
    return true
  },

  deleteProperty(target, property) {
    startBatch()
    try {
      setProperty(target, property, undefined, true)
    } finally {
      endBatch()
    }
    return true
  },

  ownKeys(target) {
    trackSelf(target)
    return Reflect.ownKeys(target)
  },

  has(target, property) {
    trackSelf(target)
    return Reflect.has(target, property)
  },

  getOwnPropertyDescriptor(target, property) {
    return Reflect.getOwnPropertyDescriptor(target, property)
  },
}

/**
 * Creates a reactive proxy for a target object.
 */
function createReactiveProxy<T extends object>(target: T): T {
  let proxy = (target as any)[$PROXY]
  if (proxy) return proxy

  proxy = proxyCache.get(target)
  if (proxy) return proxy as T

  proxy = new Proxy(target, handler)
  proxyCache.set(target, proxy)

  try {
    Object.defineProperty(target, $PROXY, { value: proxy, enumerable: false })
  } catch {
    // Frozen object, cache is enough.
  }

  primeReactivity(proxy)
  return proxy as T
}

/**
 * Recursively traverses the state to pre-emptively create signals for all properties.
 * This can improve initial read performance at the cost of slightly higher setup time.
 */
function primeReactivity(target: any, visited = new Set()): void {
  if (!isWrappable(target) || visited.has(target)) return
  visited.add(target)

  const keys = Array.isArray(target)
    ? Object.keys(target)
    : Reflect.ownKeys(target)

  for (const key of keys) {
    const value = (target as any)[key]
    primeReactivity(value, visited)
  }

  if (Array.isArray(target)) {
    void target.length
  }
}

/**
 * Updates a path in the store, following Solid's reconciliation style.
 */
function updatePath(target: any, path: any[]): void {
  let current = target
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (current && typeof current === 'object' && key in current) {
      current = current[key]
    } else {
      return
    }
  }

  const finalKey = path[path.length - 1]
  if (typeof finalKey === 'function') {
    const parentKey = path[path.length - 2]
    let parent = target
    for (let i = 0; i < path.length - 2; i++) {
      parent = parent[path[i]]
    }
    parent[parentKey] = finalKey(parent[parentKey])
  } else if (isWrappable(current) && typeof finalKey === 'object') {
    for (const key in finalKey) {
      ;(current as any)[key] = (finalKey as any)[key]
    }
  } else {
    const value = finalKey
    const property = path[path.length - 2]
    let parent = target
    for (let i = 0; i < path.length - 2; i++) {
      parent = parent[path[i]]
    }
    parent[property] = value
  }
}

export type SetStoreFunction = (...args: any[]) => void

/**
 * Creates a getter for a property on a store object.
 * This is useful for interoperability with libraries that need accessor functions.
 */
export function createAccessor<T extends object>(store: T) {
  return <K extends keyof T>(key: K): (() => T[K]) => {
    return () => store[key]
  }
}

/**
 * Creates a new reactive store.
 */
export function createStore<T extends object>(
  initialState: T
): [T, SetStoreFunction] {
  const unwrapped = unwrap(initialState || ({} as T))
  const wrapped = createReactiveProxy(unwrapped)

  function setStore(...args: any): void {
    startBatch()
    try {
      if (args.length === 1 && isWrappable(args[0])) {
        const newState = args[0]
        for (const key in unwrapped) {
          if (!(key in newState)) {
            delete (unwrapped as any)[key]
          }
        }
        for (const key in newState) {
          ;(unwrapped as any)[key] = (newState as any)[key]
        }
      } else {
        updatePath(unwrapped, args)
      }
    } finally {
      endBatch()
    }
  }

  return [wrapped, setStore]
}
