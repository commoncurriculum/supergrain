import React from 'react'

interface ForProps<T> {
  each: T[]
  children: (item: T, index: number) => React.ReactNode
  fallback?: React.ReactNode
}

/**
 * Custom For component that automatically handles version props for optimal memoization.
 * This component maps over an array and automatically passes version information to enable
 * React.memo to work correctly with supergrain proxy objects.
 *
 * @example
 * ```tsx
 * <For each={store.items}>
 *   {(item, index) => (
 *     <MemoizedItemComponent key={item.id} item={item} index={index} />
 *   )}
 * </For>
 * ```
 */
export function For<T>(props: ForProps<T>): React.JSX.Element | null {
  const { each, children, fallback } = props
  const versionSymbol = Symbol.for('supergrain:version')

  if (!each || each.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null
  }

  return React.createElement(
    React.Fragment,
    null,
    each.map((item, index) => {
      // Get version for this item if it's a proxy object
      const version =
        item && typeof item === 'object' && versionSymbol in item
          ? (item as any)[versionSymbol]
          : undefined

      // Get the child element from the render function
      const child = children(item, index)

      // If child is a React element, clone it with version prop
      if (React.isValidElement(child)) {
        // Use stable key - don't include version to avoid remounts!
        const key =
          item && typeof item === 'object' && 'id' in item
            ? (item as any).id
            : index

        return React.cloneElement(child, {
          ...(child.props as any),
          key,
          version,
        } as any)
      }

      // If not a React element, just return it
      return child
    })
  )
}
