import { useEffect } from 'react'
import { effect } from '@supergrain/core'

export interface DirectBinding {
  ref: React.RefObject<HTMLElement | null>
  getter: () => any
  attr?: string
}

/**
 * Wires signal-based getters directly to DOM nodes, bypassing React re-renders.
 *
 * This is the runtime primitive that a future compiler transformation for $$()
 * will generate. Each binding pairs a ref with a getter function. When the
 * getter's dependencies change, the DOM node is updated directly via
 * textContent (default) or the named attribute.
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
  useEffect(() => {
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
  }, [])
}
