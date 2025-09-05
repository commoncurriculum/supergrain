import { signal, Signal } from '@preact/signals-core'

type EntityId = string | number
type Entity = Record<string, any>
type Collection = Map<EntityId, Signal<Entity>>

const proxyCache = new WeakMap<object, object>()

function createReactiveProxy<T extends object>(target: T): T {
  if (proxyCache.has(target)) {
    return proxyCache.get(target) as T
  }

  // Store signals for each property of the object.
  const signals = new Map<PropertyKey, Signal<any>>()

  const getSignal = (key: PropertyKey) => {
    if (!signals.has(key)) {
      signals.set(key, signal(Reflect.get(target, key)))
    }
    return signals.get(key)!
  }

  const handler: ProxyHandler<T> = {
    get(target, key, receiver) {
      // Accessing a property subscribes to its signal.
      const value = getSignal(key).value

      // If the property is an object, wrap it in a proxy as well.
      if (value !== null && typeof value === 'object') {
        return createReactiveProxy(value)
      }

      return value
    },
    set(target, key, newValue, receiver) {
      // Setting a property updates its signal, triggering effects.
      getSignal(key).value = newValue
      // Also update the underlying cloned object.
      return Reflect.set(target, key, newValue, receiver)
    },
  }

  const proxy = new Proxy(target, handler)
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
   * wrapped in a signal to enable reactivity. If the entity already
   * exists, its signal's value is updated.
   * @param type The collection name for the entity.
   * @param id The unique identifier for the entity.
   * @param data The entity's data.
   */
  set(type: string, id: EntityId, data: Entity): void {
    const collection = this.collection(type)
    const existingSignal = collection.get(id)
    // Use structuredClone for a deep copy to prevent mutating the original object.
    const clonedData = structuredClone(data)
    const reactiveData = createReactiveProxy(clonedData)

    if (existingSignal) {
      existingSignal.value = reactiveData
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
