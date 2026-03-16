import React, { useRef, useLayoutEffect } from 'react'
import { effect } from '@supergrain/core'

type EffectRegistrar = (fn: () => void) => void

interface DirectForProps<T> {
  /** The reactive array to iterate */
  each: T[]
  /** HTML template element to clone for each item */
  template: HTMLElement
  /** Called for each item to set up DOM content, events, and signal bindings */
  setup: (item: T, element: HTMLElement, addEffect: EffectRegistrar) => void
  /** Container element type (default: 'div') */
  container?: string
  /** Optional wrapper element around the container */
  wrapper?: string
  /** Key function to identify items (default: index) */
  keyFn?: (item: T) => string | number
}

/**
 * Renders a list by cloning a DOM template for each item and wiring signal
 * effects directly to the cloned nodes — bypassing React reconciliation
 * entirely for row rendering and updates.
 *
 * The `setup` callback receives each item, the cloned DOM element, and an
 * `addEffect` helper. Effects registered via `addEffect` are automatically
 * cleaned up when `each` changes or the component unmounts.
 *
 * @example
 * ```tsx
 * const rowTemplate = document.createElement('tr')
 * rowTemplate.innerHTML = '<td></td><td><a></a></td>'
 *
 * <DirectFor
 *   each={store.data}
 *   template={rowTemplate}
 *   setup={(item, row, addEffect) => {
 *     row.querySelector('td')!.textContent = String(item.id)
 *     const a = row.querySelector('a')!
 *     a.textContent = item.label
 *     addEffect(() => { a.textContent = item[$NODE]?.label?.() ?? item.label })
 *   }}
 *   container="tbody"
 *   wrapper="table"
 * />
 * ```
 */
export function DirectFor<T>({
  each,
  template,
  setup,
  container = 'div',
  wrapper,
}: DirectForProps<T>) {
  const containerRef = useRef<HTMLElement>(null)
  const cleanupsRef = useRef<(() => void)[]>([])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    // Tear down old effects
    for (const c of cleanupsRef.current) c()
    cleanupsRef.current = []
    el.textContent = ''

    // Build rows
    for (const item of each) {
      const row = template.cloneNode(true) as HTMLElement

      const addEffect: EffectRegistrar = (fn) => {
        const dispose = effect(fn)
        cleanupsRef.current.push(dispose)
      }

      setup(item, row, addEffect)
      el.appendChild(row)
    }

    return () => {
      for (const c of cleanupsRef.current) c()
      cleanupsRef.current = []
    }
  }, [each, template, setup])

  const containerEl = React.createElement(container, { ref: containerRef })
  if (wrapper) {
    return React.createElement(wrapper, null, containerEl)
  }
  return containerEl
}
