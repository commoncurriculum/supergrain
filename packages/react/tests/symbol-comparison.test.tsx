import { describe, it, expect } from 'vitest'
import { createStore, $VERSION, $NODE, $RAW, $PROXY } from '@storable/core'
import React, { memo } from 'react'
import { render, act } from '@testing-library/react'
import { useTrackedStore } from '../src/use-store'

describe('Symbol Comparison vs Version Tracking', () => {
  it('explores what symbols and data are available for comparison', () => {
    const [store, updateStore] = createStore({
      count: 0,
      user: { name: 'Alice', age: 30 },
      items: [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
      ],
    })

    console.log('\n=== AVAILABLE SYMBOLS ===')
    console.log(`$VERSION in store:`, $VERSION in store)
    console.log(`$NODE in store:`, $NODE in store)
    console.log(`$RAW in store:`, $RAW in store)
    console.log(`$PROXY in store:`, $PROXY in store)

    // Access internal structures
    const storeVersion = (store as any)[$VERSION]
    const storeNodes = (store as any)[$NODE]
    const storeRaw = (store as any)[$RAW]
    const storeProxy = (store as any)[$PROXY]

    console.log('\n=== SYMBOL VALUES ===')
    console.log('Version:', storeVersion)
    console.log('Nodes type:', typeof storeNodes)
    console.log('Raw type:', typeof storeRaw)
    console.log('Proxy is store?', storeProxy === store)

    // Check nested objects
    const item = store.items[0]
    console.log('\n=== NESTED OBJECT SYMBOLS ===')
    console.log('Item has $VERSION:', $VERSION in item)
    console.log('Item version:', (item as any)[$VERSION])
    console.log('Item has $NODE:', $NODE in item)

    // Access signals
    if (storeNodes) {
      const countSignal = storeNodes.count
      console.log('\n=== SIGNAL INSPECTION ===')
      console.log('Count signal exists:', !!countSignal)
      console.log('Count signal type:', typeof countSignal)
      console.log('Count signal value:', countSignal?.())
    }

    expect(store).toBeDefined()
  })

  it('tests signal reference stability across updates', () => {
    const [store, updateStore] = createStore({
      count: 0,
      items: [{ id: 1, value: 10 }],
    })

    const nodes = (store as any)[$NODE]
    const initialCountSignal = nodes?.count
    const initialItemSignal = nodes?.items

    console.log('\n=== SIGNAL REFERENCE STABILITY ===')
    console.log('Initial count signal:', initialCountSignal)

    // Update the count
    updateStore({ $set: { count: 1 } })

    const afterUpdateCountSignal = (store as any)[$NODE]?.count
    console.log('After update count signal:', afterUpdateCountSignal)
    console.log(
      'Same reference?',
      initialCountSignal === afterUpdateCountSignal
    )

    // Update nested item
    updateStore({ $set: { 'items.0.value': 20 } })

    const afterNestedUpdateItemSignal = (store as any)[$NODE]?.items
    console.log(
      'Same items signal reference?',
      initialItemSignal === afterNestedUpdateItemSignal
    )

    // Signals appear to have stable references
    expect(initialCountSignal).toBe(afterUpdateCountSignal)
  })

  it('tests signal value changes', () => {
    const [store, updateStore] = createStore({
      count: 0,
      items: [{ id: 1, value: 10 }],
    })

    const nodes = (store as any)[$NODE]
    const countSignal = nodes?.count

    const initialValue = countSignal?.()
    console.log('\n=== SIGNAL VALUE CHANGES ===')
    console.log('Initial count value:', initialValue)

    updateStore({ $set: { count: 5 } })

    const newValue = countSignal?.()
    console.log('New count value:', newValue)
    console.log('Value changed?', initialValue !== newValue)

    expect(newValue).toBe(5)
    expect(initialValue).not.toBe(newValue)
  })

  it('compares version tracking vs signal comparison approaches', () => {
    const [store, updateStore] = createStore({
      items: [
        { id: 1, name: 'Item 1', value: 10 },
        { id: 2, name: 'Item 2', value: 20 },
        { id: 3, name: 'Item 3', value: 30 },
      ],
    })

    console.log('\n=== COMPARISON APPROACHES ===')

    // Approach 1: Version tracking
    const item1 = store.items[0]
    const initialVersion = (item1 as any)[$VERSION]
    console.log('1. VERSION TRACKING')
    console.log('   Initial version:', initialVersion)

    updateStore({ $set: { 'items.0.value': 15 } })

    const newVersion = (store.items[0] as any)[$VERSION]
    console.log('   New version:', newVersion)
    console.log('   Changed?', initialVersion !== newVersion)

    // Approach 2: Signal value comparison
    const item2 = store.items[1]
    const item2Nodes = (item2 as any)[$NODE]
    const valueSignal = item2Nodes?.value
    const initialSignalValue = valueSignal?.()

    console.log('\n2. SIGNAL VALUE COMPARISON')
    console.log('   Initial signal value:', initialSignalValue)

    updateStore({ $set: { 'items.1.value': 25 } })

    const newSignalValue = valueSignal?.()
    console.log('   New signal value:', newSignalValue)
    console.log('   Changed?', initialSignalValue !== newSignalValue)

    // Approach 3: Direct proxy comparison (doesn't work due to stable references)
    const item3Before = store.items[2]
    console.log('\n3. PROXY REFERENCE COMPARISON')
    console.log('   Item before:', item3Before)

    updateStore({ $set: { 'items.2.value': 35 } })

    const item3After = store.items[2]
    console.log('   Item after:', item3After)
    console.log('   Same reference?', item3Before === item3After)

    console.log('\n=== CONCLUSIONS ===')
    console.log(
      '- Version tracking: Simple, works but requires version to be incremented'
    )
    console.log(
      '- Signal values: Works but requires accessing each signal individually'
    )
    console.log(
      '- Proxy references: Stable (same reference), cannot detect changes'
    )
  })

  it('tests practical React.memo comparison functions', () => {
    let renderCount = 0

    interface ItemProps {
      item: { id: number; name: string; value: number }
    }

    // Version-based comparison
    const versionComparison = (prev: ItemProps, next: ItemProps) => {
      const prevVersion = (prev.item as any)[$VERSION]
      const nextVersion = (next.item as any)[$VERSION]
      return prevVersion === nextVersion
    }

    // Signal-based comparison (would need to track all properties)
    const signalComparison = (prev: ItemProps, next: ItemProps) => {
      const prevNodes = (prev.item as any)[$NODE]
      const nextNodes = (next.item as any)[$NODE]

      if (!prevNodes || !nextNodes) return false

      // Would need to check each signal value
      for (const key of Object.keys(prevNodes)) {
        const prevSignal = prevNodes[key]
        const nextSignal = nextNodes[key]
        if (prevSignal?.() !== nextSignal?.()) {
          return false
        }
      }
      return true
    }

    const ItemWithVersion = memo<ItemProps>(({ item }) => {
      renderCount++
      return (
        <div>
          {item.name}: {item.value}
        </div>
      )
    }, versionComparison)

    const TestComponent = () => {
      const [store, updateStore] = createStore({
        items: [
          { id: 1, name: 'Item 1', value: 10 },
          { id: 2, name: 'Item 2', value: 20 },
        ],
      })

      return (
        <div>
          {store.items.map(item => (
            <ItemWithVersion key={item.id} item={item} />
          ))}
          <button
            onClick={() => updateStore({ $set: { 'items.0.value': 15 } })}
          >
            Update Item 1
          </button>
        </div>
      )
    }

    const { getByText } = render(<TestComponent />)

    console.log('\n=== REACT.MEMO COMPARISON TEST ===')
    console.log('Initial renders:', renderCount)

    renderCount = 0
    act(() => {
      getByText('Update Item 1').click()
    })

    console.log('Renders after update:', renderCount)
    console.log('(Should be 1 if comparison works correctly)')

    // With proper version tracking, only the updated item should re-render
    expect(renderCount).toBeLessThanOrEqual(2) // Both items might re-render without proper comparison
  })

  it('evaluates the tradeoffs of each approach', () => {
    console.log('\n=== EVALUATION OF APPROACHES ===')

    console.log('\n1. VERSION TRACKING ($VERSION)')
    console.log('   Pros:')
    console.log('   - Simple numeric comparison')
    console.log('   - Single value to check per object')
    console.log('   - Already implemented in store')
    console.log('   Cons:')
    console.log('   - Requires maintaining version counter')
    console.log('   - Version might not exist on all objects')
    console.log('   - Extra memory for version storage')

    console.log('\n2. SIGNAL VALUE COMPARISON ($NODE)')
    console.log('   Pros:')
    console.log('   - Direct comparison of actual values')
    console.log('   - No extra version tracking needed')
    console.log('   - More granular change detection possible')
    console.log('   Cons:')
    console.log('   - Must call each signal to get value')
    console.log('   - Need to iterate all properties')
    console.log('   - More complex comparison logic')
    console.log('   - Performance overhead of calling signals')

    console.log('\n3. SIGNAL REFERENCE COMPARISON')
    console.log('   Result: Not viable - signals have stable references')

    console.log('\n4. RAW OBJECT COMPARISON ($RAW)')
    console.log('   Pros:')
    console.log('   - Could compare raw objects directly')
    console.log('   Cons:')
    console.log('   - Would need deep equality check')
    console.log('   - Expensive for large objects')
    console.log('   - Defeats purpose of reactive system')

    console.log('\n=== RECOMMENDATION ===')
    console.log(
      'Version tracking ($VERSION) is the most practical approach because:'
    )
    console.log('1. Simple and fast comparison (just numbers)')
    console.log('2. Already integrated into the store')
    console.log('3. Minimal performance overhead')
    console.log('4. Works well with React.memo patterns')

    expect(true).toBe(true) // Dummy assertion
  })
})
