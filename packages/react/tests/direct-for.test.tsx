import { describe, it, expect, afterEach } from 'vitest'
import React, { useReducer, useLayoutEffect } from 'react'
import { render, cleanup, act } from '@testing-library/react'
import { createStore, effect as alienEffect } from '@supergrain/core'
import { DirectFor } from '../src/direct-for'

const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = '<td></td><td><a></a></td>'

function getRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll('tr')).map(tr => ({
    id: tr.querySelector('td')!.textContent,
    label: tr.querySelector('a')!.textContent,
  }))
}

// Helper: App that subscribes to store.data changes and re-renders DirectFor
function makeApp(store: any, setupFn: (item: any, row: HTMLElement, addEffect: any) => void) {
  return function TestApp() {
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0)
    useLayoutEffect(() => {
      return alienEffect(() => {
        store.data
        forceUpdate()
      })
    }, [])

    return (
      <DirectFor
        each={store.data}
        template={rowTemplate}
        setup={setupFn}
        container="tbody"
        wrapper="table"
      />
    )
  }
}

const defaultSetup = (item: any, row: HTMLElement, addEffect: any) => {
  row.querySelector('td')!.textContent = String(item.id)
  const a = row.querySelector('a')!
  a.textContent = item.label
  addEffect(() => { a.textContent = item.label })
}

describe('DirectFor', () => {
  afterEach(() => cleanup())

  it('renders items via cloneNode', () => {
    const [store] = createStore({
      data: [{ id: 1, label: 'one' }, { id: 2, label: 'two' }],
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)
    const rows = getRows(container)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ id: '1', label: 'one' })
    expect(rows[1]).toEqual({ id: '2', label: 'two' })
  })

  it('updates label via signal effect', async () => {
    const [store] = createStore({
      data: [{ id: 1, label: 'hello' }],
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)
    expect(getRows(container)[0].label).toBe('hello')

    await act(async () => { store.data[0].label = 'world' })
    expect(getRows(container)[0].label).toBe('world')
  })

  it('creates 1000 rows', async () => {
    const [store] = createStore<{ data: { id: number; label: string }[] }>({
      data: [],
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)
    expect(getRows(container)).toHaveLength(0)

    await act(async () => {
      store.data = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }))
    })
    const rows = getRows(container)
    expect(rows).toHaveLength(1000)
    expect(rows[0]).toEqual({ id: '1', label: 'item 1' })
    expect(rows[999]).toEqual({ id: '1000', label: 'item 1000' })
  })

  it('swap rows preserves correct order', async () => {
    const [store] = createStore({
      data: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` })),
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)

    const rowsBefore = getRows(container)
    expect(rowsBefore[1]).toEqual({ id: '2', label: 'item 2' })
    expect(rowsBefore[998]).toEqual({ id: '999', label: 'item 999' })

    await act(async () => {
      const a = store.data[1]
      const b = store.data[998]
      store.data[1] = b
      store.data[998] = a
    })

    const rowsAfter = getRows(container)
    expect(rowsAfter).toHaveLength(1000)
    expect(rowsAfter[1]).toEqual({ id: '999', label: 'item 999' })
    expect(rowsAfter[998]).toEqual({ id: '2', label: 'item 2' })
    // First and last unchanged
    expect(rowsAfter[0]).toEqual({ id: '1', label: 'item 1' })
    expect(rowsAfter[999]).toEqual({ id: '1000', label: 'item 1000' })
  })

  it('remove row shifts remaining rows up', async () => {
    const [store, update] = createStore({
      data: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` })),
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)
    expect(getRows(container)).toHaveLength(10)

    await act(async () => {
      update({ $pull: { data: { id: 1 } } })
    })

    const rows = getRows(container)
    expect(rows).toHaveLength(9)
    // Row with id=1 is gone, row at position 0 should now be id=2
    expect(rows[0]).toEqual({ id: '2', label: 'item 2' })
    // Row at position 8 (formerly index 9) should be id=10
    expect(rows[8]).toEqual({ id: '10', label: 'item 10' })
  })

  it('append rows adds to existing', async () => {
    const [store] = createStore({
      data: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` })),
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)
    expect(getRows(container)).toHaveLength(1000)

    await act(async () => {
      store.data.push(
        ...Array.from({ length: 1000 }, (_, i) => ({ id: 1001 + i, label: `item ${1001 + i}` }))
      )
    })

    const rows = getRows(container)
    expect(rows).toHaveLength(2000)
    expect(rows[0]).toEqual({ id: '1', label: 'item 1' })
    expect(rows[1999]).toEqual({ id: '2000', label: 'item 2000' })
  })

  it('clear removes all rows', async () => {
    const [store] = createStore({
      data: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` })),
    })
    const App = makeApp(store, defaultSetup)
    const { container } = render(<App />)
    expect(getRows(container)).toHaveLength(100)

    await act(async () => { store.data = [] })
    expect(getRows(container)).toHaveLength(0)
  })

  it('renders empty array without errors', () => {
    const { container } = render(
      <DirectFor each={[]} template={rowTemplate} setup={() => {}} container="tbody" wrapper="table" />
    )
    expect(container.querySelectorAll('tr').length).toBe(0)
  })

  it('cleans up effects on unmount', () => {
    const [store] = createStore({ data: [{ id: 1, label: 'one' }] })
    let effectCount = 0
    const { unmount } = render(
      <DirectFor
        each={store.data}
        template={rowTemplate}
        setup={(_item, _row, addEffect) => { addEffect(() => { effectCount++ }) }}
        container="tbody"
        wrapper="table"
      />
    )
    expect(effectCount).toBe(1)
    unmount()
  })
})
