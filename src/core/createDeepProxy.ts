/**
 * A subscriber is a callback function that is notified of changes.
 */
export type Subscriber = () => void

/**
 * Creates a deep proxy that behaves like a standard JavaScript object but notifies
 * a subscriber callback whenever any of its properties (including nested ones) are mutated.
 * This provides a Vue-like deep reactivity mechanism.
 *
 * @param target The initial object to make reactive.
 * @param onChange The callback function to execute when a mutation occurs.
 * @returns A reactive proxy of the target object.
 */
export function createDeepProxy<T extends object>(
  target: T,
  onChange: Subscriber
): T {
  // WeakMap to cache proxies, ensuring object identity is maintained and preventing
  // infinite loops with circular references.
  const proxyCache = new WeakMap<object, any>()

  function createProxy<U extends object>(obj: U): U {
    // Return cached proxy if it already exists.
    if (proxyCache.has(obj)) {
      return proxyCache.get(obj)
    }

    const handler: ProxyHandler<U> = {
      /**
       * The `get` trap intercepts property access. If the accessed property is an
       * object or array, it is recursively wrapped in its own proxy to ensure
       * deep reactivity.
       */
      get(target: U, property: string | symbol, receiver: any): any {
        const value = Reflect.get(target, property, receiver)
        // Recursively create proxies for nested objects.
        if (typeof value === 'object' && value !== null) {
          return createProxy(value)
        }
        return value
      },

      /**
       * The `set` trap intercepts property assignments. It updates the value
       * and triggers the `onChange` callback if the new value is different from
       * the old one.
       */
      set(
        target: U,
        property: string | symbol,
        value: any,
        receiver: any
      ): boolean {
        const oldValue = Reflect.get(target, property, receiver)
        // Only trigger update if the value has actually changed.
        if (oldValue === value) {
          return true
        }
        const result = Reflect.set(target, property, value, receiver)
        if (result) {
          onChange() // Notify subscriber of the change.
        }
        return result
      },

      /**
       * The `deleteProperty` trap intercepts property deletions and triggers
       * the `onChange` callback upon successful deletion.
       */
      deleteProperty(target: U, property: string | symbol): boolean {
        const result = Reflect.deleteProperty(target, property)
        if (result) {
          onChange() // Notify subscriber of the change.
        }
        return result
      },
    }

    const proxy = new Proxy(obj, handler)
    proxyCache.set(obj, proxy)
    return proxy
  }

  return createProxy(target)
}
