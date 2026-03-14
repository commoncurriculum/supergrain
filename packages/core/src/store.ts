import { signal, getCurrentSub, startBatch, endBatch } from 'alien-signals'
import { update as applyUpdate, type UpdateOperations } from './operators'

// Phantom brand for compile-time store identification (no runtime property).
// Exported as a real symbol so consumers can reference `typeof $BRAND` in type positions.
export const $BRAND = Symbol.for('supergrain:brand')

export type Branded<T> =
  T extends Array<infer U>
    ? Array<Branded<U>>
    : T extends object
      ? { [K in keyof T]: Branded<T[K]> } & { readonly [$BRAND]?: true }
      : T

export type Signal<T> = {
  (): T
  (value: T): void
  $?: (value: T) => void
}

export const $NODE = Symbol.for('supergrain:node')
export const $PROXY = Symbol.for('supergrain:proxy')
export const $TRACK = Symbol.for('supergrain:track')
export const $RAW = Symbol.for('supergrain:raw')
export const $VERSION = Symbol.for('supergrain:version')
export const $OWN_KEYS = Symbol.for('ownKeys')

const proxyCache = new WeakMap<object, object>()

const isWrappable = (value: unknown): value is object =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || value.constructor === Array)

type DataNodes = Record<PropertyKey, Signal<any>>

function getNodes(target: object): DataNodes {
  let nodes = (target as any)[$NODE]
  if (!nodes) {
    nodes = {} as DataNodes
    try {
      Object.defineProperty(target, $NODE, { value: nodes, enumerable: false })
      // Initialize version tracking
      Object.defineProperty(target, $VERSION, { value: 0, writable: true, enumerable: false })
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
  newSignal.$ = newSignal as (v: any) => void
  nodes[property] = newSignal
  return newSignal
}

function wrap<T>(value: T): T {
  return isWrappable(value) ? createReactiveProxy(value) : value
}

export function unwrap<T>(value: T): T {
  return (value && (value as any)[$RAW]) || value
}

export function readSignal<T, K extends keyof T>(target: T, prop: K): T[K]
export function readSignal(target: any, prop: PropertyKey): any {
  const raw = unwrap(target)
  const nodes = getNodes(raw as object)
  const node = getNode(nodes, prop, (raw as any)[prop])
  return wrap(node())
}

export function setProperty(
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
      node(isDelete ? undefined : value)
      if ($VERSION in target) {
        const currentVersion = (target as any)[$VERSION] || 0
        ;(target as any)[$VERSION] = currentVersion + 1
      }
    }
    if (Array.isArray(target) && key !== 'length') {
      const lengthNode = nodes['length']
      if (lengthNode && target.length !== prevLen) lengthNode(target.length)
    }
  }

  const wasAdded = !hadKey && !isDelete
  const wasDeleted = hadKey && isDelete
  if ((wasAdded || wasDeleted) && nodes) {
    const ownKeysSignal = nodes[$OWN_KEYS]
    if (ownKeysSignal) {
      ownKeysSignal(ownKeysSignal() + 1)
    }
  }
}

function trackSelf(target: object): void {
  if (getCurrentSub()) {
    const nodes = getNodes(target)
    const ownKeysSignal = getNode(nodes, $OWN_KEYS, 0)
    ownKeysSignal()
  }
}

const handler: ProxyHandler<object> = {
  get(target, prop, receiver) {
    if (prop === $RAW) return target
    if (prop === $PROXY) return receiver
    if (prop === $TRACK) {
      trackSelf(target)
      return receiver
    }
    if (prop === $VERSION) return (target as any)[$VERSION] || 0

    const value = (target as any)[prop]

    // Functions: keep as-is (plus your iterator tracking)
    if (typeof value === 'function') {
      if (Array.isArray(target) && prop === Symbol.iterator) trackSelf(target)
      return value
    }

    if (!getCurrentSub()) {
      // Keep current behavior: eager wrap to preserve “always-proxy” semantics
      return wrap(value)
    }

    // Reactive context - get or create signal for this property
    const nodes = getNodes(target)
    const node = getNode(nodes, prop, value)
    return wrap(node())
  },

  set(target: any, prop: PropertyKey, value: any): boolean {
    // Enable direct mutations by calling setProperty automatically
    setProperty(target, prop, value)
    return true
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
    if (property === $RAW || property === $PROXY || property === $NODE || property === $VERSION) {
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
): [Branded<T>, SetStoreFunction] {
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

  return [state as Branded<T>, updateStore]
}
