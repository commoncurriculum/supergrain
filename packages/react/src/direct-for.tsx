import React, { useRef, useLayoutEffect } from "react";
import { effect, getCurrentSub, setCurrentSub } from "@supergrain/core";

type EffectRegistrar = (fn: () => void) => void;

interface DirectForProps<T> {
  /** The reactive array to iterate. Can be a store proxy array. */
  each: T[];
  /** HTML template element to clone for each item */
  template: HTMLElement;
  /** Called for each item to set up DOM content, events, and signal bindings */
  setup: (item: T, element: HTMLElement, addEffect: EffectRegistrar) => void;
  /** Container element type (default: 'div') */
  container?: string;
  /** Optional wrapper element around the container */
  wrapper?: string;
  /** Ref to an existing DOM element to append rows into */
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * Renders a list via cloneNode + direct signal bindings, bypassing React.
 *
 * Handles two kinds of changes:
 * 1. Array replacement (store.data = newArray) — detected via React re-render
 * 2. In-place mutations (splice, push, swap) — detected via alien-signals effect
 */
export function DirectFor<T>({
  each,
  template,
  setup,
  container = "div",
  wrapper,
  containerRef: externalRef,
}: DirectForProps<T>) {
  const internalRef = useRef<HTMLElement>(null);
  const ref = externalRef || internalRef;
  const cleanupsRef = useRef<{
    outer: (() => void) | null;
    rows: (() => void)[];
  }>({ outer: null, rows: [] });

  // rebuild: tear down old rows, build new ones from current array
  const buildRef = useRef<() => void>(() => {});
  buildRef.current = () => {
    const el = ref.current;
    if (!el) return;

    // Tear down old row effects
    for (const c of cleanupsRef.current.rows) c();
    cleanupsRef.current.rows = [];
    el.textContent = "";

    // Exit reactive context so row effects aren't nested
    const prevSub = getCurrentSub();
    setCurrentSub(undefined as any);

    for (const item of each) {
      const row = template.cloneNode(true) as HTMLElement;
      const addEffect: EffectRegistrar = (fn) => {
        cleanupsRef.current.rows.push(effect(fn));
      };
      setup(item, row, addEffect);
      el.appendChild(row);
    }

    setCurrentSub(prevSub);
  };

  useLayoutEffect(() => {
    // Clean up previous outer effect
    if (cleanupsRef.current.outer) {
      cleanupsRef.current.outer();
      cleanupsRef.current.outer = null;
    }

    // Create an alien-signals effect that watches the array structure.
    // When elements are swapped, pushed, spliced, etc., this re-runs.
    cleanupsRef.current.outer = effect(() => {
      // Subscribe to array length + every element reference
      const len = each.length;
      for (let i = 0; i < len; i++) {
        each[i]; // subscribes to each index signal
      }
      // Rebuild DOM (outside this reactive context)
      buildRef.current();
    });

    return () => {
      if (cleanupsRef.current.outer) {
        cleanupsRef.current.outer();
        cleanupsRef.current.outer = null;
      }
      for (const c of cleanupsRef.current.rows) c();
      cleanupsRef.current.rows = [];
    };
  }, [each]); // Re-run when array REFERENCE changes (store.data = newArray)

  if (externalRef) return null;

  const containerEl = React.createElement(container, { ref: internalRef });
  if (wrapper) {
    return React.createElement(wrapper, null, containerEl);
  }
  return containerEl;
}
