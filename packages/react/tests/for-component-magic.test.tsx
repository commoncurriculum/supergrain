import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { memo } from 'react'
import { createStore } from '@supergrain/core'
import { useTrackedStore, For } from '../src/use-store'
import { flushMicrotasks } from './test-utils'

describe('For Component Magic Tests', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should test if For component enables array element subscriptions', async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: 'Item 1' },
        { id: 2, label: 'Item 2' },
      ],
    })

    let withForRenderCount = 0
    let withoutForRenderCount = 0

    // Component that uses For
    const WithForComponent = memo(() => {
      withForRenderCount++
      const state = useTrackedStore(store)

      console.log(
        `WithFor: render #${withForRenderCount}, accessing state.data for For`
      )

      return (
        <div>
          <For each={state.data}>
            {(item: any) => <div key={item.id}>{item.label}</div>}
          </For>
        </div>
      )
    })

    // Component that uses regular map
    const WithoutForComponent = memo(() => {
      withoutForRenderCount++
      const state = useTrackedStore(store)

      console.log(
        `WithoutFor: render #${withoutForRenderCount}, accessing state.data for map`
      )

      return (
        <div>
          {state.data.map((item: any) => (
            <div key={item.id}>{item.label}</div>
          ))}
        </div>
      )
    })

    function TestApp() {
      return (
        <div>
          <WithForComponent />
          <WithoutForComponent />
        </div>
      )
    }

    render(<TestApp />)

    console.log('\n=== Initial render ===')
    console.log('WithFor renders:', withForRenderCount)
    console.log('WithoutFor renders:', withoutForRenderCount)

    // Test: Update data.0.label
    await act(async () => {
      console.log('\n=== Updating data.0.label ===')
      update({ $set: { 'data.0.label': 'Updated Item 1' } })
      await flushMicrotasks()
    })

    console.log('\nAfter updating data.0.label:')
    console.log('WithFor renders:', withForRenderCount)
    console.log('WithoutFor renders:', withoutForRenderCount)

    console.log('\n=== For Component Analysis ===')
    console.log(
      `For component enabled re-renders: ${
        withForRenderCount > 1 ? 'YES' : 'NO'
      }`
    )
    console.log(
      `Regular map enabled re-renders: ${
        withoutForRenderCount > 1 ? 'YES' : 'NO'
      }`
    )

    if (withForRenderCount > 1 && withoutForRenderCount === 1) {
      console.log(
        '✓ CONFIRMED: <For> component enables array element subscriptions'
      )
    } else if (withForRenderCount > 1 && withoutForRenderCount > 1) {
      console.log('? BOTH: Both For and regular map enable subscriptions')
    } else if (withForRenderCount === 1 && withoutForRenderCount === 1) {
      console.log('✗ NEITHER: Neither For nor map enable subscriptions')
    }
  })

  it('should test what exactly For component does differently', async () => {
    const [store, update] = createStore({
      data: [{ id: 1, label: 'Item 1' }],
    })

    let renderCount = 0

    const TestComponent = memo(() => {
      renderCount++
      const state = useTrackedStore(store)

      console.log(`TestComponent: render #${renderCount}`)

      // Manually replicate what For does
      console.log('About to call state.data.map...')
      const result = state.data.map((item, index) => {
        // Get version like For does
        const versionSymbol = Symbol.for('supergrain:version')
        const version =
          item && typeof item === 'object' && versionSymbol in item
            ? (item as any)[versionSymbol]
            : undefined

        console.log(`  Item ${item.id}: version=${version}`)

        return <div key={item.id}>{item.label}</div>
      })

      return <div>{result}</div>
    })

    render(<TestComponent />)

    console.log('\n=== Manual For Replication Test ===')
    console.log('Initial renders:', renderCount)

    await act(async () => {
      console.log('\n=== Updating data.0.label ===')
      update({ $set: { 'data.0.label': 'Updated!' } })
      await flushMicrotasks()
    })

    console.log('After update renders:', renderCount)
    console.log(
      `Manual For replication enabled re-renders: ${
        renderCount > 1 ? 'YES' : 'NO'
      }`
    )
  })
})
