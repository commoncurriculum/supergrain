import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'
import { createStore, getCurrentSub } from '@storable/core'
import { useReactive } from '../src/use-reactive'
import { flushMicrotasks } from './test-utils'

describe('Nested Component Tracking Debug', () => {
  it('should debug nested component tracking', async () => {
    console.log('\n=== DEBUGGING NESTED COMPONENTS ===\n')

    const [store, update] = createStore({ parent: 1, child: 10 })
    let parentRenders = 0
    let childRenders = 0
    let parentSubscriber: any = null
    let childSubscriber: any = null

    function Child() {
      console.log(`\n--- Child render #${childRenders + 1} starting ---`)
      console.log(
        'Child: Current subscriber before useReactive:',
        getCurrentSub()
      )

      useReactive()

      console.log(
        'Child: Current subscriber after useReactive:',
        getCurrentSub()
      )
      childSubscriber = getCurrentSub()

      childRenders++

      // Access child property
      const value = store.child
      console.log(`Child: Accessed store.child = ${value}`)
      console.log('Child: Subscriber after access:', getCurrentSub())
      console.log(
        'Child: Subscriber has deps?:',
        !!(childSubscriber as any)?.deps
      )

      return <span data-testid="child">{value}</span>
    }

    function Parent() {
      console.log(`\n--- Parent render #${parentRenders + 1} starting ---`)
      console.log(
        'Parent: Current subscriber before useReactive:',
        getCurrentSub()
      )

      useReactive()

      console.log(
        'Parent: Current subscriber after useReactive:',
        getCurrentSub()
      )
      parentSubscriber = getCurrentSub()

      parentRenders++

      // Access parent property
      const value = store.parent
      console.log(`Parent: Accessed store.parent = ${value}`)
      console.log('Parent: Subscriber after access:', getCurrentSub())
      console.log(
        'Parent: Subscriber has deps?:',
        !!(parentSubscriber as any)?.deps
      )

      return (
        <div>
          <span data-testid="parent">{value}</span>
          <Child />
        </div>
      )
    }

    console.log('\n=== Initial render ===')
    render(<Parent />)

    console.log('\n=== After initial render ===')
    console.log(`Parent renders: ${parentRenders}`)
    console.log(`Child renders: ${childRenders}`)
    console.log('Parent subscriber:', parentSubscriber ? 'EXISTS' : 'NULL')
    console.log('Child subscriber:', childSubscriber ? 'EXISTS' : 'NULL')
    console.log('Are they the same?:', parentSubscriber === childSubscriber)

    expect(parentRenders).toBe(1)
    expect(childRenders).toBe(1)

    console.log('\n=== Updating parent property ===')
    await act(async () => {
      console.log('Calling update for parent property...')
      update({ $set: { parent: 2 } })
      console.log('Update called, flushing microtasks...')
      await flushMicrotasks()
      console.log('Microtasks flushed')
    })

    console.log('\n=== After parent update ===')
    console.log(`Parent renders: ${parentRenders}`)
    console.log(`Child renders: ${childRenders}`)

    expect(parentRenders).toBe(2)
    expect(childRenders).toBe(2) // Child re-renders because parent re-renders

    console.log('\n=== Updating child property ===')
    await act(async () => {
      console.log('Calling update for child property...')
      update({ $set: { child: 20 } })
      console.log('Update called, flushing microtasks...')
      await flushMicrotasks()
      console.log('Microtasks flushed')
    })

    console.log('\n=== After child update ===')
    console.log(`Parent renders: ${parentRenders}`)
    console.log(`Child renders: ${childRenders}`)
    console.log('DOM parent value:', screen.getByTestId('parent').textContent)
    console.log('DOM child value:', screen.getByTestId('child').textContent)

    expect(parentRenders).toBe(2) // Parent doesn't access child property
    expect(childRenders).toBe(3) // Child should re-render
    expect(screen.getByTestId('child').textContent).toBe('20')
  })

  it('should test if child component gets its own effect', async () => {
    console.log('\n=== TESTING CHILD EFFECT INDEPENDENCE ===\n')

    const [store, update] = createStore({ value: 100 })
    const effects: Array<{ component: string; subscriber: any }> = []

    function Child() {
      console.log('Child rendering...')
      const subBefore = getCurrentSub()

      useReactive()

      const subAfter = getCurrentSub()
      effects.push({ component: 'child', subscriber: subAfter })

      console.log('Child subscriber before:', subBefore)
      console.log('Child subscriber after:', subAfter)

      return <div>{store.value}</div>
    }

    function Parent() {
      console.log('Parent rendering...')
      const subBefore = getCurrentSub()

      useReactive()

      const subAfter = getCurrentSub()
      effects.push({ component: 'parent', subscriber: subAfter })

      console.log('Parent subscriber before:', subBefore)
      console.log('Parent subscriber after:', subAfter)

      return <Child />
    }

    render(<Parent />)

    console.log('\nCollected effects:')
    effects.forEach(({ component, subscriber }) => {
      console.log(`  ${component}:`, subscriber ? 'EXISTS' : 'NULL')
      if (subscriber) {
        console.log(`    deps:`, (subscriber as any).deps ? 'YES' : 'NO')
        console.log(`    flags:`, (subscriber as any).flags)
      }
    })

    // Check if parent and child have different subscribers
    const parentSubs = effects.filter(e => e.component === 'parent')
    const childSubs = effects.filter(e => e.component === 'child')

    console.log('\nParent effects count:', parentSubs.length)
    console.log('Child effects count:', childSubs.length)

    if (parentSubs.length > 0 && childSubs.length > 0) {
      console.log(
        'Are they the same?:',
        parentSubs[0].subscriber === childSubs[0].subscriber
      )
    }

    // Now update and see what happens
    console.log('\nUpdating store...')
    effects.length = 0 // Clear

    await act(async () => {
      update({ $set: { value: 200 } })
      await flushMicrotasks()
    })

    console.log('\nEffects after update:')
    effects.forEach(({ component, subscriber }) => {
      console.log(`  ${component}:`, subscriber ? 'EXISTS' : 'NULL')
    })
  })

  it('should test tracking context restoration', () => {
    console.log('\n=== TESTING CONTEXT RESTORATION ===\n')

    let contexts: Array<{ phase: string; subscriber: any }> = []

    function Child() {
      contexts.push({ phase: 'child-start', subscriber: getCurrentSub() })

      useReactive()

      contexts.push({ phase: 'child-after-hook', subscriber: getCurrentSub() })

      React.useLayoutEffect(() => {
        contexts.push({
          phase: 'child-layout-effect',
          subscriber: getCurrentSub(),
        })
      })

      return <div>Child</div>
    }

    function Parent() {
      contexts.push({ phase: 'parent-start', subscriber: getCurrentSub() })

      useReactive()

      contexts.push({ phase: 'parent-after-hook', subscriber: getCurrentSub() })

      React.useLayoutEffect(() => {
        contexts.push({
          phase: 'parent-layout-effect',
          subscriber: getCurrentSub(),
        })
      })

      return <Child />
    }

    render(<Parent />)

    console.log('\nTracking contexts:')
    contexts.forEach(({ phase, subscriber }) => {
      console.log(
        `  ${phase}:`,
        subscriber ? `EXISTS (flags: ${(subscriber as any).flags})` : 'NULL'
      )
    })

    // Check if contexts are properly restored
    const parentStart = contexts.find(
      c => c.phase === 'parent-start'
    )?.subscriber
    const childLayoutEffect = contexts.find(
      c => c.phase === 'child-layout-effect'
    )?.subscriber

    console.log('\nContext restoration check:')
    console.log('Parent start subscriber:', parentStart ? 'EXISTS' : 'NULL')
    console.log(
      'Child layout effect subscriber:',
      childLayoutEffect ? 'EXISTS' : 'NULL'
    )
    console.log(
      'Should be restored to parent context:',
      parentStart === childLayoutEffect
    )
  })
})
