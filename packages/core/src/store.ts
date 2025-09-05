import { signal } from 'alien-signals'
import { isTracking } from './isTracking'

export type Signal<T> = {
  (): T
  (value: T): void
}

type EntityId = string | number
type Entity = Record<string, any>
type Collection = Map<EntityId, Signal<Entity>>

// A hidden symbol to store the signal cache on the raw object.
const $NODE = Symbol('storable-signals-node')

const proxyCache = new WeakMap<object, object>()

// Helper to check if a value is a plain object or array that can be proxied.
const isWrappable = (value: any): value is object =>
  value !== null && typeof value === 'object'

/**
 * Gets or creates a signal for a specific property on a target object.
 * Signals are stored in a hidden cache on the object itself.
 */
function getSignal<T extends object>(target: T, key: PropertyKey): Signal<any> {
  const node = (target as any)[$NODE]
  const sig = node?.[key]
  if (sig) {
    return sig // HOT PATH: Signal already exists.
  }

  // COLD PATH: Signal needs to be created.
  return createSignalFor(target, key)
}

/**
 * Creates a new signal for a property and stores it in the hidden cache.
 * This is the "cold path" for signal access.
 */
function createSignalFor<T extends object>(
  target: T,
  key: PropertyKey
): Signal<any> {
  let node = (target as any)[$NODE]
  if (!node) {
    node = Object.create(null)
    Object.defineProperty(target, $NODE, { value: node, configurable: true })
  }

  // Special case for the 'ownKeys' signal, which tracks shape changes.
  const initialValue =
    key === Symbol.for('ownKeys') ? 0 : Reflect.get(target, key)
  const newSignal = signal(initialValue)
  node[key] = newSignal
  return newSignal
}

const handler: ProxyHandler<object> = {
  get(target, key, receiver) {
    // FAST PATH: If not in a reactive context, return the raw value immediately.
    // NOTE: isTracking() is assumed to be exported from 'alien-signals' per the plan.
    if (!isTracking()) {
      const value = Reflect.get(target, key, receiver)
      // Important: Still wrap nested objects to ensure future reactive access is caught.
      return isWrappable(value) ? createReactiveProxy(value) : value
    }

    // SLOW PATH (REACTIVE):
    // If we are tracking, use the new helper to get the signal.
    const signal = getSignal(target, key)
    const value = signal() // Read the signal to track the dependency.

    // Recursive wrapping logic remains the same.
    return isWrappable(value) ? createReactiveProxy(value) : value
  },

  set(target, key, newValue, receiver) {
    const hadKey = Reflect.has(target, key)
    const oldValue = Reflect.get(target, key, receiver)
    const isArray = Array.isArray(target)
    const oldLength = isArray ? (target as any).length : undefined

    const result = Reflect.set(target, key, newValue, receiver)

    // Update signal for the property that was explicitly set, if its value changed.
    if (result && oldValue !== newValue) {
      getSignal(target, key)(newValue)
    }

    // For arrays, if length changed, update length signal and trigger shape change signal.
    // For objects, trigger shape change signal if a new property was added.
    if (isArray) {
      const newLength = (target as any).length
      if (oldLength !== newLength) {
        getSignal(target, 'length')(newLength)
        const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'))
        ownKeysSignal(ownKeysSignal() + 1)
      }
    } else if (!hadKey) {
      const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'))
      ownKeysSignal(ownKeysSignal() + 1)
    }
    return result
  },

  deleteProperty(target, key) {
    const hadKey = Reflect.has(target, key)
    const result = Reflect.deleteProperty(target, key)
    if (hadKey && result) {
      // Trigger shape change signal.
      const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'))
      ownKeysSignal(ownKeysSignal() + 1)
    }
    return result
  },

  ownKeys(target) {
    // Depend on the shape signal for methods like Object.keys().
    const ownKeysSignal = getSignal(target, Symbol.for('ownKeys'))
    ownKeysSignal() // Read the signal to create the dependency.
    return Reflect.ownKeys(target)
  },
}

function createReactiveProxy<T extends object>(target: T): T {
  if (proxyCache.has(target)) {
    return proxyCache.get(target) as T
  }

  const copy = (Array.isArray(target) ? [...target] : { ...target }) as T

  const proxy = new Proxy(copy, handler)
  proxyCache.set(target, proxy)
  return proxy
}

/**
 * A reactive store for managing collections of data.
 */
export class ReactiveStore {
  private collections: Map<string, Collection> = new Map()

  /**
   * Retrieves a collection by its name. If the collection doesn't exist,
   * it is created and returned.
   * @param name The name of the collection (e.g., 'posts', 'users').
   * @returns The collection, which is a Map of entity IDs to their signals.
   */
  collection(name: string): Collection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Map())
    }
    return this.collections.get(name)!
  }

  /**
   * Inserts or updates an entity in the store. The entity's data is
   * wrapped in a reactive proxy to enable reactivity. If the entity already
   * exists, its signal's value is updated.
   * @param type The collection name for the entity.
   * @param id The unique identifier for the entity.
   * @param data The entity's data.
   */
  set(type: string, id: EntityId, data: Entity): void {
    const collection = this.collection(type)
    const existingSignal = collection.get(id)
    const reactiveData = createReactiveProxy(data)

    if (existingSignal) {
      existingSignal(reactiveData)
    } else {
      collection.set(id, signal(reactiveData))
    }
  }

  /**
   * Finds an entity's signal by its type and ID.
   * @param type The collection name.
   * @param id The entity's ID.
   * @returns The signal containing the entity's data, or undefined if not found.
   */
  find(type: string, id: EntityId): Signal<Entity> | undefined {
    // We don't use this.collection(type) here because we don't want to create
    // a new collection if it doesn't exist on a find operation.
    const collection = this.collections.get(type)
    return collection?.get(id)
  }
}
