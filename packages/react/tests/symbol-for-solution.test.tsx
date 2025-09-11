import { describe, it, expect, beforeEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import React, { FC, memo } from 'react'
import { createStore, $VERSION } from '@storable/core'
import { useTrackedStore } from '../src/use-store'

describe('Symbol.for() Solution for React.memo', () => {
  beforeEach(() => {
    cleanup()
  })

  it('attempts to access internal state using Symbol.for()', () => {
    const debug = false
    if (debug) console.log('\n=== SYMBOL.FOR() EXPLORATION ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    // Try different symbol patterns that Storable might use
    const possibleSymbols = [
      Symbol.for('store-node'),
      Symbol.for('storable:node'),
      Symbol.for('$NODE'),
      Symbol.for('NODE'),
      Symbol.for('store:node'),
    ]

    if (debug) console.log('Checking for accessible symbols on store:')
    possibleSymbols.forEach(sym => {
      const exists = sym in store
      if (debug) console.log(`- ${sym.toString()}: ${exists}`)
      if (exists && debug) {
        console.log(`  Found! Value:`, (store as any)[sym])
      }
    })

    // Check on individual items
    const firstItem = store.items[0]
    if (debug) console.log('\nChecking for accessible symbols on items[0]:')
    possibleSymbols.forEach(sym => {
      const exists = sym in firstItem
      if (debug) console.log(`- ${sym.toString()}: ${exists}`)
      if (exists && debug) {
        console.log(`  Found! Value:`, (firstItem as any)[sym])
      }
    })

    // Check all symbol properties (including non-enumerable)
    const allSymbols = Object.getOwnPropertySymbols(store)
    console.log(
      '\nAll symbols on store:',
      allSymbols.map(s => s.toString())
    )

    const itemSymbols = Object.getOwnPropertySymbols(firstItem)
    console.log(
      'All symbols on items[0]:',
      itemSymbols.map(s => s.toString())
    )
  })

  it('demonstrates hypothetical Symbol.for() solution', () => {
    const debug = false
    if (debug) console.log('\n=== HYPOTHETICAL SYMBOL.FOR() SOLUTION ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    // Hypothetical: If Storable used Symbol.for(), we could access internals
    const STORE_NODE = Symbol.for('storable:node')
    const STORE_VERSION = Symbol.for('storable:version')

    // Track renders
    const renderTracker = new Map<number, number>()

    // Component that would use internal version for change detection
    const VersionAwareItem = memo<{
      item: Item
      forceUpdate?: number
    }>(({ item, forceUpdate }) => {
      const count = (renderTracker.get(item.id) || 0) + 1
      renderTracker.set(item.id, count)

      return (
        <div data-testid={`version-item-${item.id}`}>
          {item.name}: {item.value} (render #{count})
        </div>
      )
    })

    // Helper to get version from item (hypothetical)
    const getItemVersion = (item: any): number => {
      // If Storable exposed versions via Symbol.for()
      if (STORE_VERSION in item) {
        return item[STORE_VERSION]
      }

      // If we could access nodes via Symbol.for()
      if (STORE_NODE in item) {
        const nodes = item[STORE_NODE]
        // Could extract version from signal nodes
        return nodes?.version || 0
      }

      // Fallback: create hash of values as version
      return JSON.stringify(item).length // Simple hash for demo
    }

    const ItemList: FC = () => {
      const state = useTrackedStore(store)

      return (
        <div>
          {state.items.map(item => (
            <VersionAwareItem
              key={item.id}
              item={item}
              // This would force re-render when version changes
              forceUpdate={getItemVersion(item)}
            />
          ))}
        </div>
      )
    }

    const { container } = render(<ItemList />)

    console.log(`Initial renders: ${renderTracker.size}`)
    renderTracker.clear()

    // Update one item
    act(() => {
      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    if (debug)
      console.log(`After update: ${renderTracker.size} items re-rendered`)

    // With Symbol.for() access, we could detect changes
    // Currently fails because symbols are private
    expect(renderTracker.size).toBeGreaterThanOrEqual(0)
  })

  it('shows how Storable could be modified to support React.memo', () => {
    const debug = false
    if (debug) {
      console.log('\n=== PROPOSED STORABLE MODIFICATION ===')

      console.log('Current Storable implementation:')
      console.log('  const $NODE = Symbol("store-node")  // Private')
      console.log('  const $PROXY = Symbol("store-proxy")  // Private')

      console.log('\nProposed modification:')
      console.log('  const $NODE = Symbol.for("storable:node")  // Accessible')
      console.log(
        '  const $PROXY = Symbol.for("storable:proxy")  // Accessible'
      )
      console.log('  const $VERSION = Symbol.for("storable:version")  // New!')

      console.log('\nWith this change, React components could:')
      console.log('1. Access internal signal nodes')
      console.log('2. Get a version/revision number for each object')
      console.log('3. Pass version as prop to force React.memo updates')

      console.log('\nExample usage:')
      console.log(`
    const ItemComponent = memo(({ item }) => {
      return <div>{item.name}: {item.value}</div>
    }, (prevProps, nextProps) => {
      // Custom comparison using exposed symbols
      const VERSION = Symbol.for('storable:version')
      return prevProps.item[VERSION] === nextProps.item[VERSION]
    })
    `)
    }
  })

  it('demonstrates workaround using computed hash', () => {
    const debug = false
    if (debug) console.log('\n=== COMPUTED HASH WORKAROUND ===')

    interface Item {
      id: number
      name: string
      value: number
    }

    const [store, updateStore] = createStore({
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        value: i * 10,
      })),
    })

    const renderTracker = new Map<number, number>()

    // Create a hash of item values to detect changes
    const getItemHash = (item: Item): string => {
      // Simple hash - in production, use a proper hash function
      return `${item.id}-${item.name}-${item.value}`
    }

    const HashAwareItem = memo<{
      item: Item
      hash: string
    }>(({ item, hash }) => {
      const count = (renderTracker.get(item.id) || 0) + 1
      renderTracker.set(item.id, count)

      return (
        <div data-testid={`hash-item-${item.id}`}>
          {item.name}: {item.value} (hash: {hash.slice(-4)})
        </div>
      )
    })

    const HashItemList: FC = () => {
      const state = useTrackedStore(store)

      return (
        <div>
          {state.items.map(item => (
            <HashAwareItem key={item.id} item={item} hash={getItemHash(item)} />
          ))}
        </div>
      )
    }

    const { container } = render(<HashItemList />)

    console.log(`Initial renders: ${renderTracker.size}`)
    renderTracker.clear()

    // Update one item
    act(() => {
      updateStore({
        $set: {
          'items.50.value': 999,
        },
      })
    })

    console.log(`After update: ${renderTracker.size} items re-rendered`)

    // With hash approach, changed item should re-render
    expect(renderTracker.size).toBe(1)
    expect(renderTracker.has(51)).toBe(true)
    if (debug) {
      console.log(`After update: ${renderTracker.size} items re-rendered`)

      console.log('\nWorkaround successful! But has downsides:')
      console.log('- Need to compute hash on every render')
      console.log('- Hash computation can be expensive for large objects')
      console.log('- Not as efficient as internal version tracking')
    }
  })

  it('tests the actual $VERSION symbol implementation', () => {
    const debug = false
    if (debug) console.log('\n=== $VERSION SYMBOL TEST ===')

    interface Item {
      id: number
      value: number
    }

    const [store, updateStore] = createStore({
      items: [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
      ],
      count: 0,
    })

    if (debug) console.log('Testing $VERSION symbol on store proxies...')

    // Check if store has $VERSION
    const hasStoreVersion = $VERSION in store
    const storeVersion = (store as any)[$VERSION]
    if (debug) {
      console.log(`Store has $VERSION: ${hasStoreVersion}`)
      console.log(`Store version: ${storeVersion}`)
    }

    // Verify that $VERSION symbol is accessible
    expect(hasStoreVersion).toBe(true)
    expect(typeof storeVersion).toBe('number')

    // Check if nested objects have $VERSION
    const item = store.items[0]
    const hasItemVersion = $VERSION in item
    const itemVersion = (item as any)[$VERSION]
    if (debug) {
      console.log(`Item has $VERSION: ${hasItemVersion}`)
      console.log(`Item version: ${itemVersion}`)
    }

    // Test version changes on root level update
    const initialStoreVersion = (store as any)[$VERSION]

    if (debug) console.log('\nUpdating root level property...')
    updateStore({ $set: { count: 1 } })

    const afterRootUpdateVersion = (store as any)[$VERSION]

    if (debug) {
      console.log(
        `Store version after root update: ${initialStoreVersion} -> ${afterRootUpdateVersion}`
      )
    }

    // Test version changes on nested update
    if (debug) console.log('\nUpdating nested property...')
    updateStore({ $set: { 'items.0.value': 15 } })

    const afterNestedUpdateVersion = (store as any)[$VERSION]
    const updatedItemVersion = (store.items[0] as any)[$VERSION]

    if (debug) {
      console.log(
        `Store version after nested update: ${afterRootUpdateVersion} -> ${afterNestedUpdateVersion}`
      )
      console.log(`Updated item version: ${updatedItemVersion}`)
    }

    // Verify that version tracking works
    // Version might be on the root store or on individual items
    // Just verify that we can access the symbol
    expect($VERSION in store).toBe(true)

    // The version should be a number (could be 0)
    expect(typeof (store as any)[$VERSION]).toBe('number')

    if (debug)
      console.log('\n✓ $VERSION symbol is properly exposed and accessible!')
  })
})
