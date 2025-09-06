import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'
import { createStore } from '@storable/core'
import { useStore, useStoreValue } from '../src/index'

describe.skip('Import Test', () => {
  it('should import createStore from core', () => {
    const [state, update] = createStore({ count: 0 })
    expect(state.count).toBe(0)
    update({ $set: { count: 1 } })
    expect(state.count).toBe(1)
  })

  it('should import and use useStore hook', () => {
    function TestComponent() {
      const [state, update] = useStore({ count: 0 })
      return (
        <div>
          <span data-testid="count">{state.count}</span>
          <button
            data-testid="button"
            onClick={() => update({ $set: { count: 5 } })}
          >
            Set to 5
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('should import and use useStoreValue hook', () => {
    const [globalState] = createStore({ count: 10 })

    function TestComponent() {
      const state = useStoreValue(globalState)
      return <span data-testid="global">{state.count}</span>
    }

    render(<TestComponent />)
    expect(screen.getByTestId('global').textContent).toBe('10')
  })
})
