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
      Object.defineProperty(target, $NODE, { value: nodes, enumerable: false, configurable: true })
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
  else {
    target[key] = value
  }

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

/**
 * Proxy handler for reactive stores.
 *
 * The `get` trap has a fast path for re-reads of string properties that
 * already have a signal in `$NODE`. This avoids the full slow path
 * (symbol checks, `getCurrentSub()`, `getNodes()`) on subsequent reads
 * and keeps hot-loop performance close to direct property access.
 */
const handler: ProxyHandler<object> = {
  get(target, prop, receiver) {
    // Fast path: already-tracked string property (most common case on re-reads)
    // Symbols ($RAW, $PROXY, etc.) and functions skip this — they're never in $NODE
    if (typeof prop === 'string') {
      const existingNodes = (target as any)[$NODE]
      if (existingNodes) {
        const tracked = existingNodes[prop]
        if (tracked) {
          const v = tracked()
          return isWrappable(v) ? createReactiveProxy(v) : v
        }
      }
    }

    // Slow path: symbols, first-time reads, functions
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

// --- Shared prototype-getter helper ---

/** Defines a signal-reading getter on a prototype object. */
function defineSignalGetter(proto: object, key: string): void {
  Object.defineProperty(proto, key, {
    get() { return this._n[key]() },
    enumerable: true,
    configurable: true,
  })
}

// --- createView: lightweight getter-based view for compiled reads ---
const viewProtoCache = new Map<string, object>()
const viewCache = new WeakMap<object, object>()

/**
 * Creates a view with prototype getters for fast signal reads.
 *
 * V8 inlines prototype getters, making reads ~8x faster than going through
 * the Proxy handler. The view is cached per raw object — calling `createView`
 * twice with the same store returns the same view instance.
 *
 * Only properties present on the target at creation time get getters.
 * For dynamic properties added later, use the proxy directly.
 *
 * @param target - A store proxy or raw object to create a view for.
 * @returns A view object backed by the same signals as the store.
 */
export function createView<T extends object>(target: T): Readonly<T> {
  const raw = unwrap(target) as any

  // Return cached view
  const cached = viewCache.get(raw)
  if (cached) return cached as T

  const keys = Object.keys(raw)
  const cacheKey = keys.join('\0')

  // Ensure signals exist for all properties
  const nodes = getNodes(raw)
  for (const key of keys) {
    if (!nodes[key]) getNode(nodes, key, raw[key])
  }

  // Get or create shared prototype with getters
  let proto = viewProtoCache.get(cacheKey)
  if (!proto) {
    proto = {}
    for (const key of keys) {
      defineSignalGetter(proto, key)
    }
    viewProtoCache.set(cacheKey, proto)
  }

  // Create view instance backed by the prototype
  const view = Object.create(proto)
  view._n = nodes
  viewCache.set(raw, view)

  return view as T
}

// --- createModelStore: schema-driven store with pre-built view prototypes ---

interface SchemaProp {
  readonly key: string
  readonly value: any
}

interface SchemaLike {
  readonly props: readonly SchemaProp[]
  readonly infer: any
  (data: unknown): any
}

type ModelProtoEntry = {
  proto: object
  nested: Map<string, ModelProtoEntry>
}

function safeGetProps(typeValue: any): readonly SchemaProp[] | null {
  try {
    const p = typeValue?.props
    if (Array.isArray(p) && p.length > 0) return p
  } catch {
    // .props throws for non-object types (e.g., string, number)
  }
  return null
}

function buildModelProto(props: readonly SchemaProp[]): ModelProtoEntry {
  const proto = {}
  const nested = new Map<string, ModelProtoEntry>()

  for (const prop of props) {
    const key = prop.key
    const childProps = safeGetProps(prop.value)

    if (childProps && childProps.length > 0) {
      // Nested object — build its prototype recursively
      const childEntry = buildModelProto(childProps)
      nested.set(key, childEntry)
      Object.defineProperty(proto, key, {
        get() {
          const raw = this._n[key]()
          if (raw === null || raw === undefined) return raw
          // Check cache first
          const cached = modelViewCache.get(raw)
          if (cached) return cached
          // Create nested view
          const nodes = getNodes(raw)
          for (const cp of childProps) {
            if (!nodes[cp.key]) getNode(nodes, cp.key, raw[cp.key])
          }
          const view = Object.create(childEntry.proto)
          view._n = nodes
          modelViewCache.set(raw, view)
          return view
        },
        enumerable: true,
        configurable: true,
      })
    } else {
      // Leaf property — direct signal read (shared with createView)
      defineSignalGetter(proto, key)
    }
  }

  return { proto, nested }
}

const modelProtoCache = new WeakMap<object, ModelProtoEntry>()
const modelViewCache = new WeakMap<object, object>()

function getModelProto(schema: SchemaLike): ModelProtoEntry {
  let entry = modelProtoCache.get(schema)
  if (!entry) {
    entry = buildModelProto(schema.props)
    modelProtoCache.set(schema, entry)
  }
  return entry
}

function createModelView<T extends object>(
  raw: any,
  entry: ModelProtoEntry,
  props: readonly SchemaProp[]
): T {
  const cached = modelViewCache.get(raw)
  if (cached) return cached as T

  const nodes = getNodes(raw)
  for (const prop of props) {
    if (!nodes[prop.key]) getNode(nodes, prop.key, raw[prop.key])
  }

  const view = Object.create(entry.proto)
  view._n = nodes
  modelViewCache.set(raw, view)
  return view as T
}

/**
 * Creates a schema-driven store with pre-built view prototypes.
 *
 * Uses an ArkType schema to walk the type structure at creation time and
 * build shared prototype objects with getters for every property (including
 * nested objects). This avoids per-instance `Object.defineProperty` overhead.
 *
 * @param schema - An ArkType schema with `.props` and `.infer`.
 * @param initialData - Initial data matching the schema.
 * @returns `[proxy, update, view]` — the reactive proxy, an update function
 *   accepting MongoDB-style operators, and a fast view with prototype getters.
 */
export function createModelStore<S extends SchemaLike>(
  schema: S,
  initialData: S['infer']
): [Branded<S['infer']>, SetStoreFunction, S['infer']] {
  const unwrappedState = unwrap(initialData || ({} as any))
  const state = createReactiveProxy(unwrappedState)

  const entry = getModelProto(schema)
  const view = createModelView<S['infer']>(
    unwrappedState,
    entry,
    schema.props
  )

  function updateStore(operations: UpdateOperations): void {
    startBatch()
    try {
      applyUpdate(unwrappedState, operations)
    } finally {
      endBatch()
    }
  }

  return [state as Branded<S['infer']>, updateStore, view]
}

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
