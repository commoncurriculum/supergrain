import { signal, getCurrentSub, startBatch, endBatch } from 'alien-signals'

export type Signal<T> = {
  (): T
  (value: T): void
}

// Symbols for internal property storage
const $NODE = Symbol.for('store-node')
const $PROXY = Symbol.for('store-proxy')
const $TRACK = Symbol.for('store-track')
const $TARGET = Symbol.for('store-target')
const $WRAPPED = Symbol.for('store-wrapped')

// WeakMap for external references
const proxyCache = new WeakMap<object, object>()
// WeakMap for caching wrapped values to avoid recreating proxies
const wrappedCache = new WeakMap<object, WeakMap<PropertyKey, any>>()

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
 * Gets the wrapped cache for an object
 */
function getWrappedCache(target: object): WeakMap<PropertyKey, any> {
  let cache = wrappedCache.get(target)
  if (!cache) {
    cache = new WeakMap()
    wrappedCache.set(target, cache)
  }
  return cache
}

/**
 * Wraps a value in a reactive proxy if needed, with caching
 */
function wrap<T>(value: T, parent?: object, property?: PropertyKey): T {
  if (!isWrappable(value)) return value

  // Check if we have a cached wrapped version
  if (parent && property !== undefined) {
    const cache = getWrappedCache(parent)
    const cached = cache.get(property)
    if (cached) return cached
  }

  const wrapped = createReactiveProxy(value)

  // Cache the wrapped value
  if (parent && property !== undefined) {
    const cache = getWrappedCache(parent)
    cache.set(property, wrapped)
  }

  return wrapped
}

/**
 * Unwraps a proxy to get the original target
 */
export function unwrap<T>(value: T): T {
  if (!isWrappable(value)) return value
  const target = (value as any)[$TARGET]
  return target ? unwrap(target) : value
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

  // Clear wrapped cache for this property
  const cache = wrappedCache.get(target)
  if (cache) {
    cache.delete(property)
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

// Optimized array method wrappers - created once and reused
const arrayMethodWrappers = new WeakMap<object, Record<string, Function>>()

function getArrayMethodWrapper(
  target: any[],
  property: string,
  method: Function
): Function {
  let wrappers = arrayMethodWrappers.get(target)
  if (!wrappers) {
    wrappers = {}
    arrayMethodWrappers.set(target, wrappers)
  }

  if (!wrappers[property]) {
    if (
      ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].includes(
        property
      )
    ) {
      // Mutating methods
      if (property === 'splice') {
        wrappers[property] = function (this: any, ...args: any[]) {
          const start = args[0] ?? 0
          const oldLength = target.length
          const result = method.apply(target, args)
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

          // Clear wrapped cache for affected indices
          const cache = wrappedCache.get(target)
          if (cache) {
            for (let i = start; i < Math.max(oldLength, newLength); i++) {
              cache.delete(i)
            }
          }

          return result
        }
      } else {
        wrappers[property] = function (this: any, ...args: any[]) {
          let result: any
          startBatch()
