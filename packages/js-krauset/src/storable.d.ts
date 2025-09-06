declare module '@storable/core' {
  /**
   * The update function returned by createStore.
   * Accepts a MongoDB-style operator object.
   */
  type UpdateFunction<T> = (update: Record<string, any>) => void

  /**
   * Creates a reactive store.
   * @param initialState The initial state of the store.
   * @returns A tuple containing the reactive state proxy and an update function.
   */
  export function createStore<T extends object>(
    initialState: T
  ): [T, UpdateFunction<T>]
}

declare module '@storable/react' {
  /**
   * A React hook that subscribes a component to a storable store.
   * The component will re-render only when the accessed properties change.
   * @param store The reactive state proxy from `createStore`.
   * @returns The tracked state proxy.
   */
  export function useTrackedStore<T extends object>(store: T): T
}
