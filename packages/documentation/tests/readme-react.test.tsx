/**
 * README React Examples Tests
 *
 * Tests for React integration examples from the README:
 * - useTrackedStore Hook (DOC_TEST_6)  
 * - Fine-grained Reactivity (DOC_TEST_8)
 * - Memoized Components (DOC_TEST_9)
 * - For Component (DOC_TEST_10)
 */

import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { userEvent } from '@vitest/browser/context'
import { createStore } from '@storable/core'
import { useTrackedStore, For } from '@storable/react'
import { memo } from 'react'

describe('README React Examples', () => {
  describe('useTrackedStore Hook', () => {
    it('#DOC_TEST_6', async () => {
      const [store, update] = createStore({ count: 0 })

      // The primary way to use stores in React:
      function Counter() {
        const state = useTrackedStore(store)

        return (
          <div>
            <p>Count: {state.count}</p>
            <button onClick={() => update({ $inc: { count: 1 } })}>
              Increment
            </button>
          </div>
        )
      }

      render(<Counter />)

      expect(screen.getByText('Count: 0')).toBeInTheDocument()

      await userEvent.click(screen.getByText('Increment'))
      expect(screen.getByText('Count: 1')).toBeInTheDocument()
    })
  })

  describe('Fine-grained Reactivity', () => {
    it('#DOC_TEST_8', async () => {
      const [store, update] = createStore({ x: 1, y: 2, z: 3 })

      function ComponentA() {
        const state = useTrackedStore(store)
        // Only re-renders when 'x' changes
        return <div>X: {state.x}</div>
      }

      function ComponentB() {
        const state = useTrackedStore(store)
        // Only re-renders when 'y' changes
        return <div>Y: {state.y}</div>
      }

      function App() {
        return (
          <div>
            <ComponentA />
            <ComponentB />
          </div>
        )
      }

      render(<App />)

      expect(screen.getByText('X: 1')).toBeInTheDocument()
      expect(screen.getByText('Y: 2')).toBeInTheDocument()

      // Updating 'z' won't re-render ComponentA or ComponentB
      act(() => {
        update({ $set: { z: 10 } })
      })

      // Components should still show original values
      expect(screen.getByText('X: 1')).toBeInTheDocument()
      expect(screen.getByText('Y: 2')).toBeInTheDocument()

      // Update x - ComponentA should re-render because it accesses state.x
      act(() => {
        update({ $set: { x: 5 } })
      })
      // ComponentA re-renders with new value, ComponentB stays the same
      expect(screen.getByText('X: 5')).toBeInTheDocument()
      expect(screen.getByText('Y: 2')).toBeInTheDocument()
    })
  })

  describe('Using with Memoized Components', () => {
    it('#DOC_TEST_9', async () => {
      const [store, update] = createStore({
        tasks: [
          { id: 1, title: 'Task 1', completed: false },
          { id: 2, title: 'Task 2', completed: true },
        ],
        project: { taskIds: [1, 2] },
      })

      // ✅ Correct - useTrackedStore inside memoized component
      const TaskComponent = memo(
        ({ store, taskId }: { store: any; taskId: number }) => {
          const state = useTrackedStore(store)
          const task = state.tasks.find((t: any) => t.id === taskId)

          return (
            <div>
              <h3>{task.title}</h3>
              <span>{task.completed ? '✓' : '○'}</span>
            </div>
          )
        }
      )

      // Usage
      function ProjectView() {
        const state = useTrackedStore(store)

        return (
          <div>
            {state.project.taskIds.map(taskId => (
              <TaskComponent key={taskId} store={store} taskId={taskId} />
            ))}
          </div>
        )
      }

      render(<ProjectView />)

      expect(screen.getByText('Task 1')).toBeInTheDocument()
      expect(screen.getByText('Task 2')).toBeInTheDocument()
      expect(screen.getByText('✓')).toBeInTheDocument()
      expect(screen.getByText('○')).toBeInTheDocument()
    })
  })

  describe('For Component - Optimized Array Rendering', () => {
    it('#DOC_TEST_10', async () => {
      const [store, update] = createStore({
        todos: [
          { id: 1, text: 'Task 1', completed: false },
          { id: 2, text: 'Task 2', completed: true },
        ],
      })

      // Memoized component for each item
      const TodoItem = memo(({ todo }: { todo: any }) => (
        <div className={todo.completed ? 'completed' : ''}>
          {todo.text}
          <button>Toggle</button>
        </div>
      ))

      function TodoList() {
        const state = useTrackedStore(store)

        return (
          <For each={state.todos} fallback={<div>No todos yet</div>}>
            {(todo, index) => <TodoItem key={todo.id} todo={todo} />}
          </For>
        )
      }

      render(<TodoList />)

      expect(screen.getByText('Task 1')).toBeInTheDocument()
      expect(screen.getByText('Task 2')).toBeInTheDocument()

      // Check that completed class is applied
      const task2Container = screen.getByText('Task 2').closest('div')
      expect(task2Container).toHaveClass('completed')
    })
  })
})
