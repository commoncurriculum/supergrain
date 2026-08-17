import React from "react";

import { tracked } from "./tracked";
import { useComputed } from "./use-computed";

interface ShowProps<T> {
  when: T | (() => T);
  children: React.ReactNode | ((value: NonNullable<T>) => React.ReactNode);
  fallback?: React.ReactNode;
}

/**
 * Conditional rendering component — the if/else of the template helpers.
 *
 * Renders `children` while `when` is truthy, `fallback` (the else branch)
 * otherwise. Pass the condition as a **function** so it's evaluated inside
 * Show's own tracked scope, behind a computed that acts as a firewall:
 * the component subscribes to the *truthiness* of the condition, not its
 * inputs. `store.count` going 1 → 2 re-renders nothing; only a
 * truthy ↔ falsy flip swaps the branch. A plain (non-function) `when`
 * value also works, but is evaluated by the parent, so the parent
 * re-renders on every change to the condition's inputs.
 *
 * Children come in two forms:
 * - **Plain children** — best for boolean gates. Show itself never reads
 *   the condition's inputs during render, so it keeps the pure firewall.
 *   Note that plain children JSX is evaluated eagerly by the parent (a
 *   React rule, not a Supergrain one): signals read inline in that JSX
 *   subscribe the parent, so put reactive content in `tracked()`
 *   components rather than reading signals inline.
 * - **Function children** `(value) => ...` — receives the condition's
 *   (non-null) value, like Solid's keyed Show. The value is read in
 *   Show's scope, so Show also re-renders when the value itself changes
 *   while staying truthy (e.g. one user object replaced by another).
 *
 * @example
 * ```tsx
 * // Boolean gate — parent never re-renders, Show only on empty ↔ non-empty
 * <Show when={() => store.todos.length > 0} fallback={<EmptyState />}>
 *   <TodoList />
 * </Show>
 *
 * // Value form — children receive the narrowed, non-null value
 * <Show when={() => store.currentUser} fallback={<LoginButton />}>
 *   {(user) => <Avatar name={user.name} />}
 * </Show>
 * ```
 */
// tracked() erases the generic <T>, so we cast through unknown to restore it.
export const Show = tracked((props: ShowProps<unknown>) => {
  const { when, children, fallback } = props;

  const getValue = typeof when === "function" ? (when as () => unknown) : () => when;

  // Firewall: subscribe Show to the boolean result, not the condition's
  // inputs. Upstream signal changes re-run the computed, but Show only
  // re-renders when the truthiness actually flips.
  const truthy = useComputed(() => Boolean(getValue()), [when]);

  if (!truthy) {
    return fallback === undefined ? null : React.createElement(React.Fragment, null, fallback);
  }

  if (typeof children === "function") {
    // Re-read in Show's tracked scope so value changes that keep the
    // condition truthy still update the rendered branch (keyed behavior).
    const node = (children as (value: unknown) => React.ReactNode)(getValue());
    return React.createElement(React.Fragment, null, node);
  }

  return React.createElement(React.Fragment, null, children);
}) as unknown as <T>(props: ShowProps<T>) => React.JSX.Element | null;
