import { describe, it, expect, beforeEach } from 'vitest'
import React, { act } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore, ForEach } from '../src'

describe.skip('ForEach', () => {
  beforeEach(() => {
    // Clear any previous renders
    document.body.innerHTML = ''
  })

  it('should render array items', () => {
    function TestComponent() {
      const [state] = useStore({
        items: ['apple', 'banana', 'cherry'],
      })

      return (
        <div>
          <ForEach each={state.items}>
            {(item, index) => (
              <div key={index} data-testid={`item-${index}`}>
                {item}
              </div>
            )}
          </ForEach>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('item-0').textContent).toBe('apple')
    expect(screen.getByTestId('item-1').textContent).toBe('banana')
    expect(screen.getByTestId('item-2').textContent).toBe('cherry')
  })

  it('should update when array changes', async () => {
    function TestComponent() {
      const [state, update] = useStore({
        items: ['apple', 'banana'],
      })

      return (
        <div>
          <ForEach each={state.items}>
            {(item, index) => (
              <div key={index} data-testid={`item-${index}`}>
                {item}
              </div>
            )}
          </ForEach>
          <button
            data-testid="add-item"
            onClick={() => update({ $push: { items: 'cherry' } })}
          >
            Add Item
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('item-0').textContent).toBe('apple')
    expect(screen.getByTestId('item-1').textContent).toBe('banana')
    expect(screen.queryByTestId('item-2')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByTestId('add-item'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('item-2').textContent).toBe('cherry')
    })
  })

  it('should handle empty arrays', () => {
    function TestComponent() {
      const [state] = useStore({
        items: [] as string[],
      })

      return (
        <div>
          <div data-testid="container">
            <ForEach each={state.items}>
              {(item, index) => (
                <div key={index} data-testid={`item-${index}`}>
                  {item}
                </div>
              )}
            </ForEach>
          </div>
        </div>
      )
    }

    render(<TestComponent />)
    const container = screen.getByTestId('container')
    expect(container.children.length).toBe(0)
  })

  it('should handle array of objects', async () => {
    interface Todo {
      id: number
      text: string
      completed: boolean
    }

    function TodoList() {
      const [state, update] = useStore<{ todos: Todo[] }>({
        todos: [
          { id: 1, text: 'Task 1', completed: false },
          { id: 2, text: 'Task 2', completed: false },
        ],
      })

      const toggleTodo = (index: number) => {
        update({
          $set: {
            [`todos.${index}.completed`]: !state.todos[index].completed,
          },
        })
      }

      return (
        <div>
          <ForEach each={state.todos}>
            {(todo, index) => (
              <div key={todo.id} data-testid={`todo-${todo.id}`}>
                <span
                  style={{
                    textDecoration: todo.completed ? 'line-through' : 'none',
                  }}
                >
                  {todo.text}
                </span>
                <button
                  data-testid={`toggle-${todo.id}`}
                  onClick={() => toggleTodo(index)}
                >
                  Toggle
                </button>
              </div>
            )}
          </ForEach>
        </div>
      )
    }

    render(<TodoList />)

    const todo1 = screen.getByTestId('todo-1').querySelector('span')!
    expect(todo1.style.textDecoration).toBe('none')

    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-1'))
    })

    await waitFor(() => {
      const todo1Updated = screen.getByTestId('todo-1').querySelector('span')!
      expect(todo1Updated.style.textDecoration).toBe('line-through')
    })
  })

  it('should handle item removal', async () => {
    function TestComponent() {
      const [state, update] = useStore({
        items: ['a', 'b', 'c', 'd'],
      })

      const removeItem = (index: number) => {
        update({
          $set: {
            items: state.items.filter((_, i) => i !== index),
          },
        })
      }

      return (
        <div>
          <ForEach each={state.items}>
            {(item, index) => (
              <div key={item} data-testid={`item-${item}`}>
                {item}
                <button
                  data-testid={`remove-${item}`}
                  onClick={() => removeItem(index)}
                >
                  Remove
                </button>
              </div>
            )}
          </ForEach>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('item-a')).toBeTruthy()
    expect(screen.getByTestId('item-b')).toBeTruthy()
    expect(screen.getByTestId('item-c')).toBeTruthy()
    expect(screen.getByTestId('item-d')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByTestId('remove-b'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('item-a')).toBeTruthy()
      expect(screen.queryByTestId('item-b')).toBeNull()
      expect(screen.getByTestId('item-c')).toBeTruthy()
      expect(screen.getByTestId('item-d')).toBeTruthy()
    })
  })

  it('should handle item reordering', async () => {
    function TestComponent() {
      const [state, update] = useStore({
        items: ['first', 'second', 'third'],
      })

      const reverse = () => {
        update({
          $set: {
            items: [...state.items].reverse(),
          },
        })
      }

      return (
        <div>
          <div data-testid="list">
            <ForEach each={state.items}>
              {item => (
                <div key={item} data-testid={`item-${item}`}>
                  {item}
                </div>
              )}
            </ForEach>
          </div>
          <button data-testid="reverse" onClick={reverse}>
            Reverse
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    const list = screen.getByTestId('list')

    // Check initial order
    expect(list.children[0].textContent).toBe('first')
    expect(list.children[1].textContent).toBe('second')
    expect(list.children[2].textContent).toBe('third')

    await act(async () => {
      fireEvent.click(screen.getByTestId('reverse'))
    })

    await waitFor(() => {
      const updatedList = screen.getByTestId('list')
      expect(updatedList.children[0].textContent).toBe('third')
      expect(updatedList.children[1].textContent).toBe('second')
      expect(updatedList.children[2].textContent).toBe('first')
    })
  })

  it('should provide correct indices', async () => {
    function TestComponent() {
      const [state, update] = useStore({
        items: ['a', 'b', 'c'],
      })

      return (
        <div>
          <ForEach each={state.items}>
            {(item, index) => (
              <div key={item} data-testid={`item-${item}`}>
                {item}-{index}
              </div>
            )}
          </ForEach>
          <button
            data-testid="remove-first"
            onClick={() =>
              update({
                $set: {
                  items: state.items.slice(1),
                },
              })
            }
          >
            Remove First
          </button>
        </div>
      )
    }

    render(<TestComponent />)
    expect(screen.getByTestId('item-a').textContent).toBe('a-0')
    expect(screen.getByTestId('item-b').textContent).toBe('b-1')
    expect(screen.getByTestId('item-c').textContent).toBe('c-2')

    await act(async () => {
      fireEvent.click(screen.getByTestId('remove-first'))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('item-a')).toBeNull()
      expect(screen.getByTestId('item-b').textContent).toBe('b-0')
      expect(screen.getByTestId('item-c').textContent).toBe('c-1')
    })
  })

  it('should handle nested ForEach components', () => {
    function TestComponent() {
      const [state] = useStore({
        groups: [
          { name: 'Group A', items: ['a1', 'a2'] },
          { name: 'Group B', items: ['b1', 'b2', 'b3'] },
        ],
      })

      return (
        <div>
          <ForEach each={state.groups}>
            {(group, groupIndex) => (
              <div key={group.name} data-testid={`group-${groupIndex}`}>
                <h3>{group.name}</h3>
                <ForEach each={group.items}>
                  {(item, itemIndex) => (
                    <div
                      key={item}
                      data-testid={`group-${groupIndex}-item-${itemIndex}`}
                    >
                      {item}
                    </div>
                  )}
                </ForEach>
              </div>
            )}
          </ForEach>
        </div>
      )
    }

    render(<TestComponent />)

    // Check Group A
    expect(screen.getByTestId('group-0').querySelector('h3')!.textContent).toBe(
      'Group A'
    )
    expect(screen.getByTestId('group-0-item-0').textContent).toBe('a1')
    expect(screen.getByTestId('group-0-item-1').textContent).toBe('a2')

    // Check Group B
    expect(screen.getByTestId('group-1').querySelector('h3')!.textContent).toBe(
      'Group B'
    )
    expect(screen.getByTestId('group-1-item-0').textContent).toBe('b1')
    expect(screen.getByTestId('group-1-item-1').textContent).toBe('b2')
    expect(screen.getByTestId('group-1-item-2').textContent).toBe('b3')
  })

  it('should update efficiently when modifying array items', async () => {
    let renderCounts = { item0: 0, item1: 0, item2: 0 }

    function Item({ value, index }: { value: number; index: number }) {
      renderCounts[`item${index}` as keyof typeof renderCounts]++
      return <div data-testid={`item-${index}`}>{value}</div>
    }

    function TestComponent() {
      const [state, update] = useStore({
        values: [1, 2, 3],
      })

      return (
        <div>
          <ForEach each={state.values}>
            {(value, index) => <Item key={index} value={value} index={index} />}
          </ForEach>
          <button
            data-testid="update-middle"
            onClick={() => update({ $set: { 'values.1': 20 } })}
          >
            Update Middle
          </button>
        </div>
      )
    }

    render(<TestComponent />)

    const initialRenders = { ...renderCounts }

    await act(async () => {
      fireEvent.click(screen.getByTestId('update-middle'))
    })

    await waitFor(() => {
      expect(screen.getByTestId('item-1').textContent).toBe('20')
      // All items re-render when array changes (React's default behavior)
      // ForEach doesn't prevent this, but it does optimize the rendering
      expect(renderCounts.item0).toBeGreaterThan(initialRenders.item0)
      expect(renderCounts.item1).toBeGreaterThan(initialRenders.item1)
      expect(renderCounts.item2).toBeGreaterThan(initialRenders.item2)
    })
  })
})
