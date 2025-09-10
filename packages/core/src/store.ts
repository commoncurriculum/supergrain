import { signal, getCurrentSub, startBatch, endBatch } from 'alien-signals'
import { update as applyUpdate, type UpdateOperations } from './operators'

export type Signal<T> = {
  (): T
  (value: T): void
  $?: (value: T) => void
}

export const $NODE = Symbol('store-node')
const $PROXY = Symbol('store-proxy')
const $TRACK = Symbol('store-track')
const $RAW = Symbol('store-raw')

const proxyCache = new WeakMap<object, object>()

const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

type DataNodes = Record<PropertyKey, Signal<any>>

function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = Object.create(null)
    try {
      Object.defineProperty(target, $NODE, { value: nodes, enumerable: false })
    } catch {
      // Frozen objects can't be modified.
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
  const newSignal = signal(value) as Signal<any>
  newSignal.$ = (v: any) => newSignal(v)
  nodes[property] = newSignal
  return newSignal
}

function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}

export function unwrap<T>(value: T): T {
  return (value && (value as any)[$RAW]) || value
}

export function setProperty(
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

  const nodes = (target as any)[$NODE]
  if (nodes) {
    const node = nodes[property]
    if (node) {
      if (unwrap(oldValue) !== unwrap(value)) {
        node(isDelete ? undefined : value)
      }
    }

    if (Array.isArray(target) && property !== 'length') {
      const lengthNode = nodes['length']
      if (lengthNode && target.length !== (oldValue as any)?.length) {
        lengthNode(target.length)
      }
    }
  }

  const wasAdded = !hadKey && !isDelete
  const wasDeleted = hadKey && isDelete
  if ((wasAdded || wasDeleted) && nodes) {
    const ownKeysSignal = nodes[Symbol.for('ownKeys')]
    if (ownKeysSignal) {
      ownKeysSignal(ownKeysSignal() + 1)
    }
  }
}

function trackSelf(target: object): void {
  if (getCurrentSub()) {
    const nodes = getNodes(target)
    const ownKeysSignal = getNode(nodes, Symbol.for('ownKeys'), 0)
    ownKeysSignal()
  }
}

const handler: ProxyHandler<object> = {
  get(target, property, receiver) {
    if (property === $RAW) return target
    if (property === $PROXY) return receiver
    if (property === $TRACK) {
      trackSelf(target)
      return receiver
    }

    const value = Reflect.get(target, property, receiver)

    if (typeof value === 'function') {
      if (Array.isArray(target) && property === Symbol.iterator) {
        trackSelf(target)
      }
      return value
    }

    if (!getCurrentSub()) {
      return wrap(value)
    }

    const desc = Object.getOwnPropertyDescriptor(target, property)
    if (desc && (desc.get || !desc.writable)) {
      return wrap(value)
    }

    const nodes = getNodes(target)
    const nodeSignal = getNode(nodes, property, value)
    return wrap(nodeSignal())
  },

  set() {
    throw new Error(
      'Direct mutation of store state is not allowed. Use the update function.'
    )
  },

  deleteProperty() {
    throw new Error(
      'Direct deletion of store state is not allowed. Use the "$unset" operator in the update function.'
    )
  },

  ownKeys(target) {
    trackSelf(target)
    return Reflect.ownKeys(target)
  },

  has(target, property) {
    if (property === $RAW || property === $PROXY || property === $NODE) {
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

function createReactiveProxy<T extends object>(target: T): T {
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

export type SetStoreFunction = (operations: UpdateOperations) => void

export function createStore<T extends object>(
  initialState: T
): [T, SetStoreFunction] {
  const unwrappedState = unwrap(initialState || ({} as T))
  const state = createReactiveProxy(unwrappedState)

  function updateStore(operations: UpdateOperations): void {
    startBatch()
    try {
      applyUpdate(unwrappedState, operations)
      // Reconciliation is no longer needed since all operators properly use setProperty()
      // or manually trigger signals. Array operations like pullFromArray use splice() for
      // atomic modifications then trigger signals via setProperty(parent, key, array).
    } finally {
      endBatch()
    }
  }

  return [state, updateStore]
}

export { effect } from 'alien-signals'
