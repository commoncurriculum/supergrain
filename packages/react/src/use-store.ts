import React from 'react'

interface ForProps<T> {
  each: T[]
  children: (item: T, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * List rendering component for keyed reconciliation.
 *
 * Iterates an array and renders children with stable keys derived from
 * item.id (or index as fallback). Use with tracked() components for
 * per-component signal scoping.
 *
 * @example
 * ```tsx
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
export function For<T>(props: ForProps<T>): React.JSX.Element | null {
  const { each, children, fallback } = props

  if (!each || each.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null
  }

  return React.createElement(
    React.Fragment,
    null,
    each.map((item, index) => {
      const child = children(item, index)

      // Assign stable key from item.id if available
      if (React.isValidElement(child)) {
        const key =
          item && typeof item === 'object' && 'id' in item
            ? (item as any).id
            : index

        return React.cloneElement(child, { key } as any)
      }

      return child
    })
  )
}
