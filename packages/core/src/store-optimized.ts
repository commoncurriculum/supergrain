import { signal, getCurrentSub, startBatch, endBatch } from 'alien-signals'

export type Signal<T> = {
  (): T
  (value: T): void
}

// Symbols for internal property storage
const $NODE = Symbol.for('store-node')
const $PROXY = Symbol.for('store-proxy')
const $TRACK = Symbol.for('store-track')

// WeakMap for external references
const proxyCache = new WeakMap<object, object>()

// Helper to check if a value is a plain object or array that can be proxied
const isWrappable = (value: any): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

// Data nodes storage type
type DataNodes = Record<PropertyKey, Signal<any>>

/**
 * Gets or creates the nodes object for storing signals on a target
 */
function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = Object.create(null)
    Object.defineProperty(target, $NODE, {
      value: nodes,
      configurable: true,
      writable: false,
      enumerable: false,
    })
  }
  return nodes
}

/**
 * Gets or creates a signal for a property
 */
function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  const existing = nodes[property]
  if (existing) return existing

  // Create signal with no equality checking for maximum speed
  const sig = signal(value) as Signal<any>
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
  const proxy = (value as any)[$PROXY]
  return proxy ? unwrap(proxy) : value
}

/**
 * Sets a property value and updates its signal
 */
function setProperty(
  target: any,
  property: PropertyKey,
  value: any,
  deleteProperty = false
): void {
  const hadKey = property in target
  const oldValue = target[property]

  if (deleteProperty) {
    delete target[property]
  } else {
    target[property] = value
  }

  // Update the signal if the value changed
  if (oldValue !== value || deleteProperty) {
    const nodes = (target as any)[$NODE]
    if (nodes?.[property]) {
      nodes[property](deleteProperty ? undefined : value)
    }
  }

  // Handle array length changes
  if (Array.isArray(target) && property !== 'length') {
    const nodes = (target as any)[$NODE]
    if (nodes?.length) {
      nodes.length(target.length)
    }
  }

  // Trigger shape change for new/deleted properties
  if (!hadKey || deleteProperty) {
    const nodes = (target as any)[$NODE]
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

const handler: ProxyHandler<object> = {
  get(target, property, receiver) {
    // Special symbols fast path
    if (property === $PROXY) return receiver
    if (property === $TRACK) {
      trackSelf(target)
      return receiver
    }
    if (property === $NODE) return (target as any)[$NODE]

    // Non-reactive fast path
    const listener = getCurrentSub()
    if (!listener) {
      const value = target[property as keyof typeof target]
      return wrap(value)
    }

    // Check if this is an array method that should be wrapped
    if (
      Array.isArray(target) &&
      typeof property === 'string' &&
      property in Array.prototype
    ) {
      const method = Array.prototype[property as keyof typeof Array.prototype]
      if (typeof method === 'function') {
        return function (this: any, ...args: any[]) {
          // Methods that mutate the array
          if (
            [
              'push',
              'pop',
              'shift',
              'unshift',
              'splice',
              'sort',
              'reverse',
            ].includes(property)
          ) {
            // For splice, we need special handling to ensure signals update
            if (property === 'splice') {
              const start = args[0] ?? 0
              const oldLength = target.length
              const result = (method as Function).apply(target, args)
              const newLength = target.length

              // Update affected indices and length
              const nodes = (target as any)[$NODE]
              if (nodes) {
                // Update all indices from start position onwards
                const endIndex = Math.max(oldLength, newLength)
                for (let i = start; i < endIndex; i++) {
                  if (nodes[i]) {
                    nodes[i](target[i])
                  }
                }

                // Always trigger length update if it changed
                if (oldLength !== newLength && nodes.length) {
                  nodes.length(newLength)
                }

                // Trigger shape change
                const ownKeysSignal = nodes[Symbol.for('ownKeys')]
                if (ownKeysSignal) {
                  ownKeysSignal(ownKeysSignal() + 1)
                }
              }

              return result
            }

            // For other mutating methods, batch the updates
            let result: any
            startBatch()
            try {
              result = (method as Function).apply(target, args)
              // Update length signal
              const nodes = (target as any)[$NODE]
              if (nodes) {
                if (nodes.length) nodes.length(target.length)
                // Trigger shape change
                const ownKeysSignal = nodes[Symbol.for('ownKeys')]
                if (ownKeysSignal) ownKeysSignal(ownKeysSignal() + 1)
              }
            } finally {
              endBatch()
            }
            return result
          }
          // Non-mutating methods
          return (method as Function).apply(receiver, args)
        }
      }
    }

    // Hot path: existing signal
    const nodes = (target as any)[$NODE] as DataNodes | undefined
    const tracked = nodes?.[property]
    let value = tracked ? tracked() : target[property as keyof typeof target]

    // Cold path: create signal on first reactive access
    if (!tracked && listener) {
      const desc = Object.getOwnPropertyDescriptor(target, property)
      if (typeof value !== 'function' || target.hasOwnProperty(property)) {
        if (!desc?.get) {
          value = getNode(getNodes(target), property, value)()
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
    // Track shape changes
    trackSelf(target)
    return property in target
  },
}

/**
 * Creates a reactive proxy for an object without copying it
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
      // Object might be frozen or sealed
    }
    return p
  }

  // Create proxy for ORIGINAL object, not a copy
  p = new Proxy(target, handler)

  // Dual caching strategy
  proxyCache.set(target, p)
  try {
    Object.defineProperty(target, $PROXY, {
      value: p,
      configurable: true,
      writable: false,
      enumerable: false,
    })
  } catch {
    // Object might be frozen or sealed
  }

  return p
}

/**
 * Updates an array efficiently with minimal signal updates
 */
function updateArray(current: any[], next: any[]): void {
  startBatch()
  try {
    let i = 0
    const len = next.length

    // Update existing indices
    for (; i < len; i++) {
      if (current[i] !== next[i]) {
        setProperty(current, i, next[i])
      }
    }

    // Only update length if it changed
    if (current.length !== len) {
      setProperty(current, 'length', len)
      // Remove extra elements
      for (let j = len; j < current.length; j++) {
        delete current[j]
      }
    }
  } finally {
    endBatch()
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
 */
export function createStore<T extends object>(
  initialState?: T
): [T, SetStoreFunction<T>] {
  const unwrapped = unwrap(initialState || ({} as T))
  const wrapped = createReactiveProxy(unwrapped)

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

// Legacy API compatibility
type EntityId = string | number
type Entity = Record<string, any>
type Collection = Map<EntityId, Signal<Entity>>

/**
 * A reactive store for managing collections of data.
 * @deprecated Use createStore instead
 */
export class ReactiveStore {
  private collections: Map<string, Collection> = new Map()

  collection(name: string): Collection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map())
    }
    return this.collections.get(name)!
  }

  set(type: string, id: EntityId, data: Entity): void {
    const collection = this.collection(type)
    const existingSignal = collection.get(id)
    const reactiveData = createReactiveProxy(data)

    if (existingSignal) {
      existingSignal(reactiveData)
    } else {
      collection.set(id, signal(reactiveData) as Signal<Entity>)
    }
  }

  find(type: string, id: EntityId): Signal<Entity> | undefined {
    const collection = this.collections.get(type)
    return collection?.get(id)
  }
}
