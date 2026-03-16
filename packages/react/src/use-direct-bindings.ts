import { useLayoutEffect } from 'react'
import { effect } from '@supergrain/core'

export interface DirectBinding {
  ref: React.RefObject<HTMLElement | null>
  getter: () => any
  attr?: string
}

/**
 * Direct DOM binding sigil. Marks a reactive expression for direct DOM updates.
 *
 * Without the compiler, acts as an identity function — your code works normally
 * through React, just without the direct DOM optimization.
 *
 * With the Vite compiler plugin, `$$()` calls are transformed into `useRef` +
 * `useDirectBindings` pairs that wire alien-signals effects straight to DOM
 * nodes, bypassing React's reconciliation for updates.
 *
 * @example
 * ```tsx
 * // Text content binding
 * <a>{$$(item.label)}</a>
 *
 * // Attribute binding (use arrow for expressions)
 * <tr className={$$(() => selected === item.id ? 'danger' : '')}>
 * ```
 */
export function $$<T>(value: T): T {
  return value
}

/**
 * Wires signal-based getters directly to DOM nodes, bypassing React re-renders.
 *
 * This is the runtime primitive that the compiler transformation for `$$()` generates.
 * Each binding pairs a ref with a getter function. When the getter's signal
 * dependencies change, the DOM node is updated directly via `textContent`
 * (default) or the named attribute.
 *
 * Uses `useLayoutEffect` so bindings are wired before paint, preventing a
 * flash of initial content.
 *
 * @example
 * ```tsx
 * function Row({ item, store }) {
 *   const labelRef = useRef<HTMLAnchorElement>(null)
 *   const trRef = useRef<HTMLTableRowElement>(null)
 *
 *   useDirectBindings([
 *     { ref: labelRef, getter: () => item.label },
 *     { ref: trRef, getter: () => store.selected === item.id ? 'danger' : '', attr: 'className' },
 *   ])
 *
 *   return (
 *     <tr ref={trRef}>
 *       <td>{item.id}</td>
 *       <td><a ref={labelRef}>{item.label}</a></td>
 *     </tr>
 *   )
 * }
 * ```
 */
export function useDirectBindings(bindings: DirectBinding[]): void {
  useLayoutEffect(() => {
    const cleanups = bindings.map(({ ref, getter, attr }) => {
      return effect(() => {
        const el = ref.current
        if (!el) return
        const value = getter()
        if (attr) {
          ;(el as any)[attr] = value
        } else {
          el.textContent = String(value)
        }
      })
    })
    return () => {
      for (const c of cleanups) c()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- bindings are stable (compiler-generated)
  }, [])
}
