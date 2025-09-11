import { describe, it, expect } from 'vitest'
import React, { memo } from 'react'
import { render, act } from '@testing-library/react'
import { createStore } from '@storable/core'
import { useTrackedStore, propsAreEqual } from '../src/use-store'

describe('Debug propsAreEqual Version Tracking', () => {
  it('should check if versions are item-specific or global', () => {
    const [store, updateStore] = createStore({
      items: [
        { id: 1, name: 'Item 1', value: 100 },
        { id: 2, name: 'Item 2', value: 200 },
        { id: 3, name: 'Item 3', value: 300 },
      ],
    })

    const versionSymbol = Symbol.for('storable:version')
    const versionsBeforeUpdate: Record<number, number> = {}
    const versionsAfterUpdate: Record<number, number> = {}
    const renderLog: Array<{ id: number; phase: string; version: number }> = []

    const Item = memo(({ item, phase }: { item: any; phase: string }) => {
      const version = item[versionSymbol] || 0
      renderLog.push({ id: item.id, phase, version })
      console.log(
        `Render - Item ${item.id} - Phase: ${phase} - Version: ${version}`
      )
      return (
        <div>
          {item.name}: {item.value}
        </div>
      )
    }, propsAreEqual)

    function App({ phase }: { phase: string }) {
      const state = useTrackedStore(store)

      // Capture versions
      if (phase === 'before') {
        state.items.forEach(item => {
          versionsBeforeUpdate[item.id] = item[versionSymbol] || 0
        })
      } else if (phase === 'after') {
        state.items.forEach(item => {
          versionsAfterUpdate[item.id] = item[versionSymbol] || 0
        })
      }

      return (
        <div>
          {state.items.map(item => (
            <Item key={item.id} item={item} phase={phase} />
          ))}
        </div>
      )
    }

    // Initial render
    const { rerender } = render(<App phase="initial" />)

    // Capture versions before update
    rerender(<App phase="before" />)

    console.log('Versions before update:', versionsBeforeUpdate)

    // Update only item 2
    act(() => {
      updateStore({ $set: { 'items.1.value': 250 } })
    })

    // Capture versions after update
    rerender(<App phase="after" />)

    console.log('Versions after update:', versionsAfterUpdate)
    console.log('Version changes:')
    console.log(
      '- Item 1:',
      versionsBeforeUpdate[1],
      '->',
      versionsAfterUpdate[1]
    )
    console.log(
      '- Item 2:',
      versionsBeforeUpdate[2],
      '->',
      versionsAfterUpdate[2]
    )
    console.log(
      '- Item 3:',
      versionsBeforeUpdate[3],
      '->',
      versionsAfterUpdate[3]
    )

    // Analyze render log
    const initialRenders = renderLog.filter(r => r.phase === 'initial')
    const afterRenders = renderLog.filter(r => r.phase === 'after')

    console.log('\nRender analysis:')
    console.log('Initial renders:', initialRenders.length)
    console.log('After update renders:', afterRenders.length)
    console.log('\nDetailed render log:')
    renderLog.forEach(log => {
      console.log(`  Item ${log.id} - ${log.phase} - version: ${log.version}`)
    })

    // Check if only item 2's version changed
    expect(versionsAfterUpdate[1]).toBe(versionsBeforeUpdate[1])
    expect(versionsAfterUpdate[2]).not.toBe(versionsBeforeUpdate[2])
    expect(versionsAfterUpdate[3]).toBe(versionsBeforeUpdate[3])
  })

  it('should test propsAreEqual function directly', () => {
    const [store, updateStore] = createStore({
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ],
    })

    function App() {
      const state = useTrackedStore(store)
      return <div>{state.items.length}</div>
    }

    render(<App />)

    const versionSymbol = Symbol.for('storable:version')
    const item1 = store.items[0]
    const item2 = store.items[1]

    console.log('\nDirect propsAreEqual test:')
    console.log('Item 1 initial version:', item1[versionSymbol])
    console.log('Item 2 initial version:', item2[versionSymbol])

    // Test propsAreEqual with same props
    const props1 = { item: item1, id: 1 }
    const result1 = propsAreEqual(props1, props1)
    console.log('Same props object:', result1) // Should be true

    // Test with same values but different prop objects
    const props2a = { item: item1, id: 1 }
    const props2b = { item: item1, id: 1 }
    const result2 = propsAreEqual(props2a, props2b)
    console.log('Different prop objects, same item:', result2)

    // Update item 2
    act(() => {
      updateStore({ $set: { 'items.1.name': 'Updated Item 2' } })
    })

    console.log('After update:')
    console.log('Item 1 version:', item1[versionSymbol])
    console.log('Item 2 version:', item2[versionSymbol])

    // Test after update
    const props3a = { item: item2, id: 2 }
    const props3b = { item: item2, id: 2 }
    const result3 = propsAreEqual(props3a, props3b)
    console.log('After update, same item2 reference:', result3)

    // The key insight: after the first comparison, the version should be cached
    const result4 = propsAreEqual(props3b, props3b)
    console.log('Second comparison with same props:', result4) // Should be true now
  })

  it('should examine WeakMap caching behavior', () => {
    const [store] = createStore({
      item: { id: 1, name: 'Test' },
    })

    const versionSymbol = Symbol.for('storable:version')
    const proxyVersionCache = new WeakMap<object, number>()

    // Simulate what propsAreEqual does
    const item = store.item
    const version1 = item[versionSymbol] || 0

    console.log('\nWeakMap test:')
    console.log('Initial version:', version1)

    // First check - not in cache
    const cached1 = proxyVersionCache.get(item)
    console.log('First cache check:', cached1) // undefined

    // Store in cache
    proxyVersionCache.set(item, version1)

    // Second check - should be in cache
    const cached2 = proxyVersionCache.get(item)
    console.log('Second cache check:', cached2) // Should be version1

    // Check if we're using the same proxy reference
    const item2 = store.item
    console.log('Same proxy reference?', item === item2) // Should be true

    const cached3 = proxyVersionCache.get(item2)
    console.log('Cache check with second reference:', cached3) // Should still be version1
  })
})
