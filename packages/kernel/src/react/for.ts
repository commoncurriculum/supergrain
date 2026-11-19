/* eslint-disable typescript-eslint/prefer-for-of --
 * Index loops on purpose: `for…of` allocates an iterator per loop.
 */
import { effect, unwrap, $TRACK } from "@supergrain/kernel";
import { setActiveSub, trackArrayElements, type ReactiveTagged } from "@supergrain/kernel/internal";
import React, { memo, useEffect, useLayoutEffect, useReducer, useRef } from "react";

import { tracked } from "./tracked";

/* c8 ignore start -- the React project runs in a browser; this branch is for SSR consumers */
const useIsomorphicLayoutEffect = globalThis.document === undefined ? useEffect : useLayoutEffect;
/* c8 ignore stop */

type Children = (item: unknown, index: number) => React.ReactNode;
type Elements = Map<unknown, React.ReactNode>;

interface ForProps<T> {
  each: ReadonlyArray<T>;
  children: (item: T, index: number) => React.ReactNode;
  fallback?: React.ReactNode;
  parent?: React.RefObject<Element | null>;
}

const ForItem = tracked(
  ({ item, index, children }: { item: unknown; index: number; children: Children }) =>
    children(item, index),
);

/**
 * List rendering with per-row reactivity. `For` re-renders only when the list
 * changes (items added, removed, replaced, moved); a change inside an item
 * re-renders only the row that reads it. Rows are keyed by `item.id`, else by
 * object identity, else by index.
 *
 * Pass `children` an index parameter only if you use it: rows then re-render
 * when they move. A defaulted `(item, i = 0)` counts as no index.
 *
 * With a `parent` ref, a swap of two items moves their DOM nodes with no React
 * render. `children` is then called once per item and reused, so children
 * MUST be `tracked()` components to update when an item's fields change.
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
export const For = memo((props: ForProps<unknown>) =>
  props.parent
    ? React.createElement(ForInParent, props as ParentProps)
    : React.createElement(ForRows, props),
) as unknown as <T>(props: ForProps<T>) => React.JSX.Element | null;

const ForRows = tracked(({ each, children, fallback }: ForProps<unknown>) => {
  void (each as ReactiveTagged)?.[$TRACK];
  const raw = unwrap(each);
  if (!raw || raw.length === 0) return fallback ?? null;
  trackArrayElements(raw);
  // Untracked: the array is already followed as a whole.
  const outer = setActiveSub(undefined);
  try {
    return rowComponents(raw, each, children);
  } finally {
    setActiveSub(outer);
  }
});

type ParentProps = ForProps<unknown> & { parent: React.RefObject<Element | null> };

const ForInParent = tracked(({ each, children, fallback, parent }: ParentProps) => {
  const [, rerender] = useReducer(increment, 0);
  const stateRef = useRef<ForState | null>(null);
  const state: ForState = (stateRef.current ??= {
    elements: new Map(),
    shown: [],
    placed: [],
    swappedIn: null,
  });

  void (each as ReactiveTagged)?.[$TRACK];
  const raw = unwrap(each);

  useIsomorphicLayoutEffect(() => {
    const { shown } = state;
    // UndoSwaps already restored React's order before this commit.
    forgetSwaps(state);
    if (!raw || raw.length === 0) {
      shown.length = 0;
      return;
    }
    shown.length = raw.length;
    for (let i = 0; i < raw.length; i++) shown[i] = raw[i];
    return effect(() => {
      trackArrayElements(raw);
      if (raw.length !== shown.length) return;
      // Compare raw: an assigned element may be stored as a proxy.
      let a = -1;
      let b = -1;
      for (let i = 0; i < raw.length; i++) {
        if (unwrap(raw[i]) !== unwrap(shown[i])) {
          if (a === -1) a = i;
          else if (b === -1) b = i;
          else {
            rerender();
            return;
          }
        }
      }
      if (a === -1) return;
      const container = parent.current;
      // A hole renders no node, so with holes DOM index != array index.
      if (
        b === -1 ||
        !container ||
        container.children.length !== raw.length ||
        unwrap(raw[a]) !== unwrap(shown[b]) ||
        unwrap(raw[b]) !== unwrap(shown[a])
      ) {
        rerender();
        return;
      }
      const nodeA = container.children[a]!;
      const nodeB = container.children[b]!;
      if (state.swappedIn === null) {
        const { placed } = state;
        const nodes = container.children;
        placed.length = nodes.length;
        for (let i = 0; i < nodes.length; i++) placed[i] = nodes[i]!;
        state.swappedIn = container;
      }
      swapElements(nodeA, nodeB);
      shown[a] = raw[a];
      shown[b] = raw[b];
    });
  });

  if (!raw || raw.length === 0) {
    state.elements.clear();
    return fallback ?? null;
  }

  // Untracked: the array is already followed as a whole.
  const outer = setActiveSub(undefined);
  try {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(UndoSwaps, { state }),
      reusedElements(raw, each, children, state),
    );
  } finally {
    setActiveSub(outer);
  }
});

const increment = (n: number): number => n + 1;

interface ForState {
  elements: Elements;
  shown: Array<unknown>;
  placed: Array<Element>;
  swappedIn: Element | null;
}

// React reconciles DOM nodes by the order of its last render, so swapped nodes
// must be put back first. getSnapshotBeforeUpdate runs in the commit just
// before DOM changes, and never for a render React drops (e.g. suspended).
class UndoSwaps extends React.Component<{ state: ForState }> {
  override getSnapshotBeforeUpdate(): null {
    undoSwaps(this.props.state);
    return null;
  }

  override componentDidUpdate(): void {}

  override render(): null {
    return null;
  }
}

function undoSwaps(state: ForState): void {
  const { placed, swappedIn } = state;
  if (swappedIn === null) return;
  let cursor = swappedIn.firstElementChild;
  for (let i = 0; i < placed.length; i++) {
    const node = placed[i]!;
    if (node.parentNode === swappedIn) {
      // A node not yet put back is at or after `cursor`, so `cursor` is set.
      if (node !== cursor) swapElements(cursor!, node);
      cursor = node.nextElementSibling;
    }
  }
  forgetSwaps(state);
}

function forgetSwaps(state: ForState): void {
  state.placed.length = 0;
  state.swappedIn = null;
}

// `x` must precede `y`.
function swapElements(x: Element, y: Element): void {
  const afterX = x.nextSibling!;
  if (afterX === y) {
    x.before(y);
    return;
  }
  y.before(x);
  afterX.before(y);
}

function reusedElements(
  raw: ReadonlyArray<unknown>,
  each: ReadonlyArray<unknown>,
  children: Children,
  state: ForState,
): Array<React.ReactNode> {
  const previous = state.elements;
  // Not `previous.clear()`: it is read while this fills, and V8 reallocates
  // the table on clear anyway.
  const next: Elements = new Map();
  const slots = new Array<React.ReactNode>(raw.length); // eslint-disable-line unicorn/no-new-array -- sized once, holes kept where `raw` has them
  for (let i = 0; i < raw.length; i++) {
    if (!isHole(raw, i)) {
      const rawItem = unwrap(raw[i]);
      const element = previous.get(rawItem) ?? children(each[i], i);
      next.set(rawItem, element);
      slots[i] = element;
    }
  }
  state.elements = next;
  return slots;
}

// Shared across calls: safe only while rowComponents never runs user code.
const usedKeys = new Set<string>();

function rowComponents(
  raw: ReadonlyArray<unknown>,
  each: ReadonlyArray<unknown>,
  children: Children,
): Array<React.ReactNode> {
  // Function.length excludes defaulted params: `(item, i = 0)` reads as 1.
  const passIndex = children.length !== 1;
  const slots = new Array<React.ReactNode>(raw.length); // eslint-disable-line unicorn/no-new-array -- sized once, holes kept where `raw` has them
  for (let i = 0; i < raw.length; i++) {
    if (!isHole(raw, i)) {
      let key = keyOf(unwrap(raw[i]), i);
      if (usedKeys.has(key)) key = positionKey(i);
      usedKeys.add(key);
      slots[i] = React.createElement(ForItem, {
        key,
        item: each[i],
        index: passIndex ? i : 0,
        children,
      });
    }
  }
  usedKeys.clear();
  return slots;
}

function isHole(raw: ReadonlyArray<unknown>, i: number): boolean {
  return raw[i] === undefined && !(i in raw);
}

const objectKeys = new WeakMap<object, string>();
let nextObjectKey = 0;

// React compares keys as strings: ids 1 and "1" collide.
function keyOf(rawItem: unknown, index: number): string {
  if (!rawItem || typeof rawItem !== "object") return positionKey(index);
  const { id } = rawItem as { id?: unknown };
  if (typeof id === "string" || typeof id === "number") return String(id);
  let key = objectKeys.get(rawItem);
  if (key === undefined) {
    key = `\u0000o${nextObjectKey++}`;
    objectKeys.set(rawItem, key);
  }
  return key;
}

// \u0000 prefix keeps position keys apart from ordinary ids.
function positionKey(index: number): string {
  return `\u0000${index}`;
}
