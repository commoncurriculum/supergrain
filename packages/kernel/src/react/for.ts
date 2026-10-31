import { effect, unwrap, $TRACK } from "@supergrain/kernel";
import { setActiveSub, trackArrayElements, type ReactiveTagged } from "@supergrain/kernel/internal";
import React, { useEffect, useLayoutEffect, useReducer, useRef } from "react";

/* c8 ignore start -- the React project runs in a browser; this branch is for SSR consumers */
const useIsomorphicLayoutEffect = globalThis.document === undefined ? useEffect : useLayoutEffect;
/* c8 ignore stop */

import { tracked } from "./tracked";

type Children = (item: unknown, index: number) => React.ReactNode;

interface ForProps<T> {
  each: ReadonlyArray<T>;
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
  parent?: React.RefObject<Element | null>;
}

/**
 * One row without `parent`: a tracked boundary around `children(item)`, so
 * inline children (`{(todo) => <li>{todo.text}</li>}`) re-render on their own
 * when a field they read changes. Keyed by the item, so a row that only moved
 * keeps its component; it re-renders only if `children` takes the index.
 */
const ForItem = tracked(
  ({ item, index, children }: { item: unknown; index: number; children: Children }) =>
    children(item, index),
);

/**
 * List rendering component with fine-grained per-element reactivity.
 *
 * `For` re-renders when the list itself changes: an item added, removed,
 * replaced or moved. It never re-renders for a change inside an item; the
 * row that reads that field does. Rows are keyed by item (`item.id`, or the
 * index for items without one), so when items shift — say one leaves the
 * top of a sorted list — the rows that only moved keep their components.
 *
 * With a `parent` ref, swapping two items moves their two DOM nodes directly,
 * with no React render at all. Any other change re-renders `For` as usual.
 * In this mode `children` is called once per item and its result is reused,
 * so children MUST be `tracked()` components (e.g. `<Row />`) to update when
 * an item's fields change.
 *
 * @example
 * ```tsx
 * // Fast path — O(1) swap (children must be tracked)
 * const tbodyRef = useRef<HTMLTableSectionElement>(null)
 * <tbody ref={tbodyRef}>
 *   <For each={store.data} parent={tbodyRef}>
 *     {(item) => <Row key={item.id} item={item} />}
 *   </For>
 * </tbody>
 *
 * // Standard path — no ref needed, inline children OK
 * <For each={store.data}>
 *   {(item) => <Row key={item.id} item={item} />}
 * </For>
 * ```
 */
export const For = tracked((props: ForProps<unknown>) => {
  const { each, children, fallback, parent } = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Parent mode: the element `children` returned for each item, reused while
  // the item stays in the list.
  const elementsRef = useRef(new Map<unknown, React.ReactNode>());

  // Structure (push, splice, length, a new array) always re-renders `For`.
  void (each as ReactiveTagged)?.[$TRACK];
  const raw = unwrap(each);
  // Without `parent`, so does replacing an item in place. With `parent`, the
  // effect below decides: a swap moves DOM nodes, anything else re-renders.
  if (!parent && raw) trackArrayElements(raw);

  useIsomorphicLayoutEffect(() => {
    if (!parent || !raw || raw.length === 0) return;
    // The items in the order the DOM shows them. A swap updates it in place;
    // any other change re-renders `For`, which runs this effect again.
    const shown = [...raw];
    return effect(() => {
      trackArrayElements(raw);
      // A length change already re-renders `For`.
      if (raw.length !== shown.length) return;
      const changed = changedSlots(shown, raw);
      if (changed.length === 0) return;
      const container = parent.current;
      if (!container || !isSwap(shown, raw, changed)) {
        rerender();
        return;
      }
      const [a, b] = changed as [number, number];
      const nodeA = container.children[a]!;
      const nodeB = container.children[b]!;
      const siblingA = nodeA.nextSibling === nodeB ? nodeA : nodeA.nextSibling!;
      nodeB.after(nodeA);
      siblingA.before(nodeB);
      shown[a] = raw[a];
      shown[b] = raw[b];
    });
  });

  if (!raw || raw.length === 0) {
    // Drop the last rows' elements, so a cleared list holds nothing.
    elementsRef.current = new Map();
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }

  // Item reads below are untracked: `For` already follows the array as a
  // whole, and per-index subscriptions would only add N links.
  const prevSub = setActiveSub(undefined);
  try {
    const slots = parent
      ? reusedElements(raw, each, children, elementsRef)
      : rowComponents(raw, each, children);
    return React.createElement(React.Fragment, null, ...slots);
  } finally {
    setActiveSub(prevSub);
  }
}) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;

/**
 * Parent mode: `children(item)` once per item, reused for as long as the item
 * stays in the list, so React skips rows whose element didn't change.
 */
function reusedElements(
  raw: ReadonlyArray<unknown>,
  each: ReadonlyArray<unknown>,
  children: Children,
  elementsRef: React.RefObject<Map<unknown, React.ReactNode>>,
): Array<React.ReactNode> {
  const previous = elementsRef.current;
  const next = new Map<unknown, React.ReactNode>();
  const slots = raw.map((item, i) => {
    const rawItem = unwrap(item);
    const element = previous.get(rawItem) ?? children(each[i], i);
    next.set(rawItem, element);
    return element;
  });
  elementsRef.current = next;
  return slots;
}

/** Without `parent`: one `ForItem` per item, keyed by item. */
function rowComponents(
  raw: ReadonlyArray<unknown>,
  each: ReadonlyArray<unknown>,
  children: Children,
): Array<React.ReactNode> {
  // A row's index changes whenever an item above it is added or removed.
  // Pass it only when `children` declares an index parameter, so that
  // `(item) => …` rows that merely moved skip re-rendering. (A defaulted
  // index, `(item, i = 0) => …`, doesn't count as declared: write
  // `(item, i) => …`.)
  const passIndex = children.length !== 1;
  return raw.map((item, i) =>
    React.createElement(ForItem, {
      key: keyOf(item, i),
      item: each[i],
      index: passIndex ? i : 0,
      children,
    }),
  );
}

/**
 * The indices whose item differs between `shown` and `next` (same length),
 * comparing raw objects: an assigned element may be stored as a proxy. Stops
 * at three, since that is already more than a swap.
 */
function changedSlots(shown: ReadonlyArray<unknown>, next: ReadonlyArray<unknown>): Array<number> {
  const changed: Array<number> = [];
  for (let i = 0; i < next.length && changed.length < 3; i++) {
    if (unwrap(next[i]) !== unwrap(shown[i])) changed.push(i);
  }
  return changed;
}

/** Whether the two changed slots traded items. */
function isSwap(
  shown: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
  changed: ReadonlyArray<number>,
): boolean {
  if (changed.length !== 2) return false;
  const [a, b] = changed as [number, number];
  if (unwrap(next[a]) !== unwrap(shown[b])) return false;
  return unwrap(next[b]) === unwrap(shown[a]);
}

function keyOf(rawItem: unknown, index: number): React.Key {
  return rawItem && typeof rawItem === "object" && "id" in rawItem
    ? (rawItem as { id: React.Key }).id
    : index;
}
