import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { createStore } from '@supergrain/core'
import { DirectFor } from '../src/direct-for'

// Create template
const rowTemplate = document.createElement('tr')
rowTemplate.innerHTML = '<td></td><td><a></a></td>'

describe('DirectFor', () => {
  afterEach(() => cleanup())

  it('renders items via cloneNode', () => {
    const [store] = createStore({
      data: [
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
      ],
    })

    const { container } = render(
      <DirectFor
        each={store.data}
        template={rowTemplate}
        setup={(item: any, row) => {
          row.querySelector('td')!.textContent = String(item.id)
          row.querySelector('a')!.textContent = item.label
        }}
        container="tbody"
        wrapper="table"
      />,
    )

    const rows = container.querySelectorAll('tr')
    expect(rows.length).toBe(2)
    expect(rows[0].querySelector('td')!.textContent).toBe('1')
    expect(rows[0].querySelector('a')!.textContent).toBe('one')
    expect(rows[1].querySelector('a')!.textContent).toBe('two')
  })

  it('updates DOM directly via signal effects', async () => {
    const [store] = createStore({
      data: [{ id: 1, label: 'hello' }],
    })

    const { container } = render(
      <DirectFor
        each={store.data}
        template={rowTemplate}
        setup={(item: any, row, addEffect) => {
          row.querySelector('td')!.textContent = String(item.id)
          const a = row.querySelector('a')!
          a.textContent = item.label

          // Wire signal effect — reading through the proxy inside the effect
          // automatically creates and subscribes to the signal
          addEffect(() => {
            a.textContent = item.label
          })
        }}
        container="tbody"
        wrapper="table"
      />,
    )

    expect(container.querySelector('a')!.textContent).toBe('hello')

    await act(async () => {
      store.data[0].label = 'world'
    })

    expect(container.querySelector('a')!.textContent).toBe('world')
  })

  it('cleans up effects on unmount', () => {
    const [store] = createStore({
      data: [{ id: 1, label: 'one' }],
    })

    let effectCount = 0
    const { container, unmount } = render(
      <DirectFor
        each={store.data}
        template={rowTemplate}
        setup={(_item, row, addEffect) => {
          row.querySelector('td')!.textContent = '1'
          addEffect(() => {
            effectCount++
          })
        }}
        container="tbody"
        wrapper="table"
      />,
    )

    expect(effectCount).toBe(1) // initial run
    expect(container.querySelectorAll('tr').length).toBe(1)

    // Unmount should not throw (effects cleaned up)
    unmount()
  })

  it('renders empty array without errors', () => {
    const { container } = render(
      <DirectFor
        each={[]}
        template={rowTemplate}
        setup={() => {}}
        container="tbody"
        wrapper="table"
      />,
    )

    expect(container.querySelectorAll('tr').length).toBe(0)
  })

  it('uses default container (div) when not specified', () => {
    const [store] = createStore({ data: [{ id: 1 }] })
    const template = document.createElement('span')
    template.textContent = 'item'

    const { container } = render(
      <DirectFor
        each={store.data}
        template={template}
        setup={() => {}}
      />,
    )

    expect(container.querySelector('div')).toBeTruthy()
    expect(container.querySelectorAll('span').length).toBe(1)
  })
})
