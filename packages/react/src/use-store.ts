import { unwrap } from "@supergrain/core";
import React from "react";

import { tracked } from "./tracked";

const $TRACK = Symbol.for("supergrain:track");

interface ForProps<T> {
  each: T[];
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Internal slot component that reads a single array element reactively.
 *
 * Each ForItem subscribes to only its own per-index signal. On an element
 * swap, only the ForItems at swapped indices re-render — the parent For
 * and all other ForItems stay untouched.
 */
const ForItem = tracked(
  ({
    each,
    index,
    children,
  }: {
    each: unknown[];
    index: number;
    children: (item: unknown, index: number) => React.ReactNode;
  }) => {
    // Read through the proxy — subscribes to this index's signal only
    const item = each[index];
    const child = children(item, index);
    return child as React.ReactElement;
  },
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * For subscribes to both structural changes (ownKeys) and per-index signals.
 * Each element is rendered through an internal ForItem tracked component.
 *
 * - Swap: For re-renders to update keys so React moves DOM nodes (keyed).
 *   ForItem memo passes for unmoved items; only moved items re-render.
 * - Add/Remove: For re-renders to adjust the slot count.
 * - Property update: Per-index signals don't fire (same object at same index),
 *   so For stays quiet. ForItem's tracked scope handles the re-render.
 *
 * @example
 * ```tsx
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const For = tracked((props: ForProps<unknown>) => {
  const { each, children, fallback } = props;

  // Subscribe to structural changes (ownKeys: add, remove, splice).
  void (each as any)?.[$TRACK];

  const raw = unwrap(each);

  if (!raw || raw.length === 0) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Read each element through the proxy to subscribe to per-index signals.
  // This ensures For re-renders on swap (element identity change at an index),
  // which is required for correct keyed reconciliation (DOM node moves).
  // Per-index signals do NOT fire on property updates (e.g., label change),
  // so For stays quiet for those — ForItem handles property reactivity.
  for (let i = 0; i < raw.length; i++) {
    void each[i];
  }

  // Build slot list from raw array for key extraction.
  const slots = [];
  for (let i = 0; i < raw.length; i++) {
    const rawItem = raw[i];
    const key =
      rawItem && typeof rawItem === "object" && "id" in rawItem
        ? ((rawItem as Record<string, unknown>).id as React.Key)
        : i;

    slots.push(
      React.createElement(ForItem, {
        key,
        each,
        index: i,
        children,
      }),
    );
  }

  return React.createElement(React.Fragment, null, ...slots);
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;
