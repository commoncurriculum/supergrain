import {
  signal,
  getCurrentSub,
  startBatch,
  endBatch,
  effect,
} from 'alien-signals'

export type Signal<T> = {
  (): T
  (value: T): void
}

// Symbols for internal property storage
const $NODE = Symbol('store-node')
const $PROXY = Symbol('store-proxy')
const $TRACK = Symbol('store-track')

// WeakMap for external references (fallback when object is frozen)
const proxyCache = new WeakMap<object, object>()

// Descriptor cache for property descriptors
const descriptorCache = new WeakMap<
  object,
  Map<PropertyKey, PropertyDescriptor | null>
>()

// Helper to check if a value is a plain object or array that can be proxied
const isWrappable = (value: any): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

// Data nodes storage type
type DataNodes = Record<PropertyKey, Signal<any>>

/**
 * Gets cached property descriptor for optimal property access
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
 * Gets or creates the nodes object for storing signals on a target
 * Optimized for minimal overhead
 */
function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = Object.create(null)
    try {
      Object.defineProperty(target, $NODE, {
        value: nodes,
        configurable: true,
        writable: false,
        enumerable: false,
      })
    } catch {
      // Object might be frozen or sealed, store in WeakMap instead
      // For frozen objects, we can't store signals directly on them
      return nodes
    }
  }
  return nodes
}

/**
 * Gets or creates a signal for a property with no equality checking
 * for maximum performance
 */
function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  const existing = nodes[property]
  if (existing) return existing

  const sig = signal(value)

  nodes[property] = sig
  return sig
}

/**
 * Wraps a value in a reactive proxy if needed
 */
function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}

/**
 * Unwraps a proxy to get the original target
 */
export function unwrap<T>(value: T): T {
  if (!isWrappable(value)) return value
  // Check if this is a proxy by looking for the $PROXY symbol
  // The $PROXY symbol points to the proxy itself, not the target
  // So we shouldn't recursively unwrap it
  const proxySymbol = (value as any)[$PROXY]
  // If it has the symbol and it points to itself, it's a proxy, return the value
  if (proxySymbol === value) return value
  // Otherwise, return the original value
  return value
}

/**
 * Sets a property value and updates its signal
 * Optimized for minimal overhead in hot path
 */
function setProperty(
  target: any,
  property: PropertyKey,
  value: any,
  deleteProperty = false
): void {
  const hadKey = property in target

  if (deleteProperty) {
    delete target[property]
  } else {
    target[property] = value
  }

  // Update the signal if value changed (no equality check, always update)
  const nodes = (target as any)[$NODE]
  if (nodes?.[property]) {
    // The signal exists, update it
    const sig = nodes[property]
    // Call the signal setter to update the value
    sig(deleteProperty ? undefined : value)
  }

  // Handle array length changes
  if (Array.isArray(target) && property !== 'length') {
    if (nodes?.['length']) {
      nodes['length'](target.length)
    }
  }

  // Trigger shape change for new/deleted properties
  if (!hadKey || deleteProperty) {
    const ownKeysSignal = nodes?.[Symbol.for('ownKeys')]
    if (ownKeysSignal) {
      ownKeysSignal(ownKeysSignal() + 1)
    }
  }
}

/**
 * Tracks the target object itself (for operations like Object.keys)
 */
function trackSelf(target: object): void {
  const listener = getCurrentSub()
  if (!listener) return

  const nodes = getNodes(target)
  const ownKeysSignal = getNode(nodes, Symbol.for('ownKeys'), 0)
  ownKeysSignal() // Read to create dependency
}

/**
 * Optimized handler for array methods
 */
const arrayMethodHandler = {
  push: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const oldLength = target.length
    const result = method.apply(target, args)
    if (nodes['length'] && target.length !== oldLength) {
      nodes['length'](target.length)
    }
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) ownKeysSignal(ownKeysSignal() + 1)
    return result
  },

  pop: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const oldLength = target.length
    const result = method.apply(target, args)
    if (nodes['length'] && target.length !== oldLength) {
      nodes['length'](target.length)
    }
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) ownKeysSignal(ownKeysSignal() + 1)
    return result
  },

  shift: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const result = method.apply(target, args)
    // Update all indices since they all shift
    for (let i = 0; i < target.length; i++) {
      const sig = nodes[i]
      if (sig) sig(target[i])
    }
    if (nodes['length']) nodes['length'](target.length)
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) ownKeysSignal(ownKeysSignal() + 1)
    return result
  },

  unshift: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const result = method.apply(target, args)
    // Update all indices since they all shift
    for (let i = 0; i < target.length; i++) {
      const sig = nodes[i]
      if (sig) sig(target[i])
    }
    if (nodes['length']) nodes['length'](target.length)
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) ownKeysSignal(ownKeysSignal() + 1)
    return result
  },

  splice: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const start = args[0] ?? 0
    const oldLength = target.length
    const result = method.apply(target, args)
    const newLength = target.length

    // Only update signals for indices that actually changed
    if (nodes) {
      // Update modified indices only if needed
      const updateEnd = Math.min(start + args.length - 2, newLength)
      for (let i = start; i < updateEnd; i++) {
        const sig = nodes[i]
        if (sig) sig(target[i])
      }

      // If items were removed, update signals for shifted indices
      if (oldLength > newLength) {
        for (let i = newLength; i < oldLength; i++) {
          const sig = nodes[i]
          if (sig) sig(undefined)
        }
      }

      if (oldLength !== newLength && nodes['length']) {
        nodes['length'](newLength)
      }

      const ownKeysSignal = nodes[Symbol.for('ownKeys')]
      if (ownKeysSignal) ownKeysSignal(ownKeysSignal() + 1)
    }

    return result
  },

  sort: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const result = method.apply(target, args)
    // Update all indices since order changed
    for (let i = 0; i < target.length; i++) {
      const sig = nodes[i]
      if (sig) sig(target[i])
    }
    return result
  },

  reverse: function (
    target: any[],
    nodes: DataNodes,
    method: Function,
    args: any[]
  ) {
    const result = method.apply(target, args)
    // Update all indices since order changed
    for (let i = 0; i < target.length; i++) {
      const sig = nodes[i]
      if (sig) sig(target[i])
    }
    return result
  },
}

const handler: ProxyHandler<object> = {
  get(target, property, receiver) {
    // Special symbols fast path
    if (property === $PROXY) return receiver
    if (property === $TRACK) {
      trackSelf(target)
      return receiver
    }
    if (property === $NODE) return (target as any)[$NODE]

    // Non-reactive fast path - check listener first
    const listener = getCurrentSub()
    if (!listener) {
      const value = target[property as keyof typeof target]
      return wrap(value)
    }

    // Optimized array method handling
    if (
      Array.isArray(target) &&
      typeof property === 'string' &&
      property in arrayMethodHandler
    ) {
      const methodHandler = (arrayMethodHandler as any)[property]
      const method = Array.prototype[property as keyof typeof Array.prototype]
      return function (this: any, ...args: any[]) {
        let result: any
        startBatch()
        try {
          const nodes = (target as any)[$NODE] as DataNodes | undefined
          result = nodes
            ? methodHandler(target, nodes, method, args)
            : (method as Function).apply(target, args)
        } finally {
          endBatch()
        }
        return result
      }
    }

    // Check for other array methods
    if (
      Array.isArray(target) &&
      typeof property === 'string' &&
      property in Array.prototype
    ) {
      const method = Array.prototype[property as keyof typeof Array.prototype]
      if (typeof method === 'function') {
        // Non-mutating methods can be called directly
        return function (this: any, ...args: any[]) {
          return (method as Function).apply(receiver, args)
        }
      }
    }

    // Hot path: Check for existing signal first
    const nodes = (target as any)[$NODE] as DataNodes | undefined
    if (nodes?.[property]) {
      // Signal exists - read it directly (inlined for performance)
      const value = nodes[property]()
      return wrap(value)
    }

    // Cold path: No signal exists yet
    const value = target[property as keyof typeof target]

    // Only create signal if we have a listener and it's a trackable property
    if (typeof value !== 'function') {
      const desc = getCachedDescriptor(target, property)
      if (!desc?.get) {
        // Create signal for this property
        try {
          const signalNodes = getNodes(target)
          const sig = getNode(signalNodes, property, value)
          const trackedValue = sig()
          return wrap(trackedValue)
        } catch {
          // If we can't create nodes (frozen object), just return the value
          return wrap(value)
        }
      }
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
    return property in target
  },

  getOwnPropertyDescriptor(target, property) {
    trackSelf(target)
    return Reflect.getOwnPropertyDescriptor(target, property)
  },
}

/**
 * Creates a reactive proxy for an object without copying it
 * Optimized with dual caching strategy
 */
function createReactiveProxy<T extends object>(target: T): T {
  // Check if already proxied via symbol (fastest)
  let p = (target as any)[$PROXY]
  if (p) return p

  // Check WeakMap cache (for external references)
  p = proxyCache.get(target)
  if (p) {
    // Store on object for faster access next time
    try {
      Object.defineProperty(target, $PROXY, {
        value: p,
        configurable: true,
        writable: false,
        enumerable: false,
      })
    } catch {
      // Object might be frozen or sealed, continue with WeakMap only
    }
    return p
  }

  // Create proxy for ORIGINAL object, not a copy
  p = new Proxy(target, handler)

  // Dual caching strategy for maximum performance
  proxyCache.set(target, p)
  try {
    Object.defineProperty(target, $PROXY, {
      value: p,
      configurable: true,
      writable: false,
      enumerable: false,
    })
  } catch {
    // Object might be frozen or sealed, WeakMap cache is sufficient
  }

  return p
}

/**
 * Updates an array efficiently with minimal signal updates
 * Uses Solid.js reconciliation strategy
 */
function updateArray(current: any[], next: any[]): void {
  let i = 0
  const len = next.length
  const nodes = (current as any)[$NODE] as DataNodes | undefined

  // Update existing indices only if values differ
  for (; i < len; i++) {
    if (current[i] !== next[i]) {
      current[i] = next[i]
      if (nodes) {
        const sig = nodes[i]
        if (sig) {
          sig(next[i])
        }
      }
    }
  }

  // Only update length if it changed
  if (current.length !== len) {
    // Remove extra elements
    for (let j = len; j < current.length; j++) {
      delete current[j]
      if (nodes) {
        const sig = nodes[j]
        if (sig) {
          sig(undefined)
        }
      }
    }

    current.length = len
    if (nodes?.['length']) {
      nodes['length'](len)
    }

    // Trigger shape change
    const ownKeysSignal = nodes?.[Symbol.for('ownKeys')]
    if (ownKeysSignal) {
      ownKeysSignal(ownKeysSignal() + 1)
    }
  }
}

/**
 * Recursively traverses the state to trigger signal creation.
 */
function primeReactivity(target: any, visited = new Set()): void {
  if (!isWrappable(target) || visited.has(target)) return
  visited.add(target)

  for (const key in target) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      const value = target[key as keyof typeof target] // Access property to trigger proxy `get`
      primeReactivity(value, visited)
    }
  }

  if (Array.isArray(target)) {
    // Access length to trigger proxy `get`
    const _ = target.length
  }
}

/**
 * Updates a path in the store
 */
function updatePath(target: any, path: any[]): void {
  if (path.length === 0) return

  if (path.length === 1) {
    // Direct value assignment
    if (Array.isArray(target) && Array.isArray(path[0])) {
      updateArray(target, path[0])
    } else if (typeof path[0] === 'object') {
      // Merge object
      for (const key in path[0]) {
        setProperty(target, key, path[0][key])
      }
    }
    return
  }

  // Navigate to the target property
  let current = target
  for (let i = 0; i < path.length - 2; i++) {
    const key = path[i]
    current = current[key]
    if (!current) return
  }

  const lastKey = path[path.length - 2]
  const value = path[path.length - 1]

  if (typeof value === 'function') {
    // Updater function
    setProperty(current, lastKey, value(current[lastKey]))
  } else {
    setProperty(current, lastKey, value)
  }
}

export type SetStoreFunction<T> = {
  (...args: any[]): void
}

/**
 * Creates a reactive store with Solid.js-like API
 * Optimized for maximum performance
 */
export function createStore<T extends object>(
  initialState?: T
): [T, SetStoreFunction<T>] {
  const unwrapped = unwrap(initialState || ({} as T))
  const wrapped = createReactiveProxy(unwrapped)

  // Prime reactivity by accessing all properties within an effect
  const dispose = effect(() => primeReactivity(wrapped))
  dispose()

  function setStore(...args: any[]) {
    startBatch()
    try {
      if (
        Array.isArray(unwrapped) &&
        args.length === 1 &&
        Array.isArray(args[0])
      ) {
        updateArray(unwrapped, args[0])
      } else {
        updatePath(unwrapped, args)
      }
    } finally {
      endBatch()
    }
  }

  return [wrapped, setStore as SetStoreFunction<T>]
}

/**
 * Creates an optimized accessor for a specific property
 * Use this for extremely hot paths where every nanosecond counts
 */
export function createAccessor<T extends object, K extends keyof T>(
  target: T,
  property: K
): { get: () => T[K]; set: (value: T[K]) => void } {
  createReactiveProxy(target)
  const nodes = getNodes(target)
  const node = getNode(nodes, property as PropertyKey, target[property])

  return {
    get: () => {
      const value = node()
      return wrap(value) as T[K]
    },
    set: (value: T[K]) => {
      startBatch()
      try {
        node(unwrap(value))
        target[property] = unwrap(value) as any
      } finally {
        endBatch()
      }
    },
  }
}
