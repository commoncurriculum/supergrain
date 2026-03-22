import React from "react";

import { tracked } from "./tracked";

interface ForProps<T> {
  each: T[];
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * List rendering component for keyed reconciliation.
 *
 * Iterates an array and renders children with stable keys derived from
 * item.id (or index as fallback). Wrapped in tracked() so that in-place
 * array mutations (push, splice, etc.) trigger re-renders by subscribing
 * to the array's length and ownKeys signals.
 *
 * @example
 * ```tsx
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
export const For: <T>(props: ForProps<T>) => React.JSX.Element | null = tracked(
  <T>(props: ForProps<T>): React.JSX.Element | null => {
    const { each, children, fallback } = props;

    if (!each || each.length === 0) {
      return fallback ? React.createElement(React.Fragment, null, fallback) : null;
    }

    return React.createElement(
      React.Fragment,
      null,
      each.map((item, index) => {
        const child = children(item, index);

        // Assign stable key from item.id if available
        if (React.isValidElement(child)) {
          const key = item && typeof item === "object" && "id" in item ? (item as any).id : index;

          return React.cloneElement(child, { key } as any);
        }

        return child;
      }),
    );
  },
) as any;
