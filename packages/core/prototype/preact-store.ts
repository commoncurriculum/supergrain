/**
 * Minimal createStore backed by preact signals.
 * Mirrors core's architecture exactly — same proxy handler pattern,
 * same lazy signal creation, same operator/update path — but uses
 * @preact/signals-core instead of alien-signals.
 *
 * This exists solely for benchmarking: "what if core used preact signals?"
 */

import { signal, batch, Signal } from '@preact/signals-core'

const $NODE = Symbol.for('preact-bench:node')
const $PROXY = Symbol.for('preact-bench:proxy')
const $RAW = Symbol.for('preact-bench:raw')
const $OWN_KEYS = Symbol.for('preact-bench:ownKeys')

const proxyCache = new WeakMap<object, object>()

// Preact doesn't expose getCurrentSub() like alien-signals does.
// Core uses getCurrentSub() to skip signal creation for non-reactive reads.
// We always track here — slightly more work on non-reactive reads, but
// ensures correctness and matches what happens in a real app where
// component reads are always reactive.
function isInReactiveContext(): boolean {
  return true
}

type DataNodes = Record<PropertyKey, Signal<any>>

const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = {} as DataNodes
    try {
      Object.defineProperty(target, $NODE, { value: nodes, enumerable: false })
    } catch {
      // Frozen objects
    }
  }
  return nodes
}

function getNode(
  nodes: DataNodes,
  property: PropertyKey,
  value?: any
): Signal<any> {
  if (nodes[property]) {
    return nodes[property]!
  }
  const s = signal(value)
  nodes[property] = s
  return s
}

function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}

function unwrap<T>(value: T): T {
  return (value && (value as any)[$RAW]) || value
}

function setProperty(
  target: any,
  key: PropertyKey,
  value: any,
  isDelete = false
) {
  const hadKey = Object.prototype.hasOwnProperty.call(target, key)
  const prevLen = Array.isArray(target) ? target.length : -1
  const oldValue = target[key]

  if (isDelete) delete target[key]
  else target[key] = value

  const nodes = (target as any)[$NODE]
  if (nodes) {
    const node = nodes[key]
    if (node && unwrap(oldValue) !== unwrap(value)) {
      node.value = isDelete ? undefined : value
    }
    if (Array.isArray(target) && key !== 'length') {
      const lengthNode = nodes['length']
      if (lengthNode && target.length !== prevLen) lengthNode.value = target.length
    }
  }

  const wasAdded = !hadKey && !isDelete
  const wasDeleted = hadKey && isDelete
  if ((wasAdded || wasDeleted) && nodes) {
    const ownKeysSignal = nodes[$OWN_KEYS]
    if (ownKeysSignal) {
      ownKeysSignal.value = ownKeysSignal.value + 1
    }
  }
}

function trackSelf(target: object): void {
  if (isInReactiveContext()) {
    const nodes = getNodes(target)
    const ownKeysSignal = getNode(nodes, $OWN_KEYS, 0)
    ownKeysSignal.value // read to subscribe
  }
}

const handler: ProxyHandler<object> = {
  get(target, prop, receiver) {
    if (prop === $RAW) return target
    if (prop === $PROXY) return receiver

    const value = (target as any)[prop]

    if (typeof value === 'function') {
      if (Array.isArray(target) && prop === Symbol.iterator) trackSelf(target)
      return value
    }

    if (!isInReactiveContext()) {
      return wrap(value)
    }

    const nodes = getNodes(target)
    const node = getNode(nodes, prop, value)
    return wrap(node.value)
  },

  set(target: any, prop: PropertyKey, value: any): boolean {
    setProperty(target, prop, value)
    return true
  },

  deleteProperty() {
    throw new Error('Direct deletion not allowed.')
  },

  ownKeys(target) {
    trackSelf(target)
    return Reflect.ownKeys(target)
  },

  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $NODE) return true
    trackSelf(target)
    return Reflect.has(target, property)
  },
}

function createReactiveProxy<T extends object>(target: T): T {
  if ((target as any)[$PROXY]) return (target as any)[$PROXY]
  if (proxyCache.has(target)) return proxyCache.get(target) as T
  if (Object.isFrozen(target)) return target

  const proxy = new Proxy(target, handler)
  proxyCache.set(target, proxy)

  try {
    Object.defineProperty(target, $PROXY, { value: proxy, enumerable: false })
  } catch {}

  return proxy as T
}

// --- Operators (same logic as core, just using our setProperty) ---

function resolvePath(target: object, path: string): { parent: any; key: string } | null {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]!]
    if (current == null || typeof current !== 'object') return null
  }
  return { parent: current, key: parts[parts.length - 1]! }
}

function setPathValue(target: object, path: string, value: unknown): void {
  const parts = path.split('.')
  let current: any = target
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    if (current[part] === undefined) setProperty(current, part, {})
    current = current[part]
  }
  setProperty(current, parts[parts.length - 1]!, value)
}

function $set(target: object, operations: Record<string, unknown>): void {
  for (const path in operations) {
    setPathValue(target, path, operations[path])
  }
}

type UpdateOperations = { $set?: Record<string, any> }

export function createPreactStore<T extends object>(
  initialState: T
): [T, (ops: UpdateOperations) => void] {
  const unwrappedState = unwrap(initialState || ({} as T))
  const state = createReactiveProxy(unwrappedState)

  function updateStore(operations: UpdateOperations): void {
    batch(() => {
      if (operations.$set) {
        $set(unwrappedState, operations.$set)
      }
    })
  }

  return [state, updateStore]
}
