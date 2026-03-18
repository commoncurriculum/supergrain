import { type FC, memo, useReducer, useRef, useEffect } from 'react'
import { effect, getCurrentSub, setCurrentSub } from '@supergrain/core'

/**
 * Wraps a React component with per-component signal scoping.
 *
 * All reactive proxy reads during the component's render are tracked to
 * that component's own alien-signals effect. When any tracked signal
 * changes, only this component re-renders — not the parent.
 *
 * Also wraps the component in React.memo for standard memoization.
 *
 * Safe on non-reactive components: if no reactive proxies are read,
 * the effect has zero dependencies and never fires. The component
 * behaves identically to memo().
 *
 * @example
 * ```tsx
 * const Row = tracked(({ item, isSelected }) => {
 *   // item.label and item.id reads are scoped to this Row's effect.
 *   // A label change on this item re-renders only this Row.
 *   return (
 *     <tr className={isSelected ? 'danger' : ''}>
 *       <td>{item.id}</td>
 *       <td>{item.label}</td>
 *     </tr>
 *   )
 * })
 *
 * const App = tracked(() => {
 *   const selected = store.selected
 *   return (
 *     <For each={store.data}>
 *       {(item) => (
 *         <Row
 *           key={item.id}
 *           item={item}
 *           isSelected={selected === item.id}
 *         />
 *       )}
 *     </For>
 *   )
 * })
 * ```
 */
export function tracked<P extends object>(Component: FC<P>) {
  const Tracked: FC<P> = (props: P) => {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
    const ref = useRef<{ cleanup: (() => void); effectNode: any } | null>(null)

    if (!ref.current) {
      let effectNode: any = null
      let firstRun = true
      const cleanup = effect(() => {
        if (firstRun) {
          effectNode = getCurrentSub()
          firstRun = false
          return
        }
        forceUpdate()
      })
      ref.current = { cleanup, effectNode }
    }

    useEffect(() => {
      return () => {
        ref.current?.cleanup?.()
      }
    }, [])

    const prev = getCurrentSub()
    setCurrentSub(ref.current.effectNode)
    const result = Component(props)
    setCurrentSub(prev)
    return result
  }

  return memo(Tracked)
}
