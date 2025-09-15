/**
 * React Integration Tests
 *
 * Tests all the React integration examples from the documentation
 * to ensure they work as documented.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { userEvent } from '@vitest/browser/context'
import { createStore } from '@storable/core'
import { useTrackedStore, useStore, For } from '@storable/react'
import { memo, useState } from 'react'

describe('React Integration Examples', () => {
  describe('useTrackedStore Hook', () => {
    it('should create reactive components with useTrackedStore', async () => {
      const [store, update] = createStore({ count: 0 })

      function Counter() {
        const state = useTrackedStore(store)

        return (
          <div>
            <p data-testid="count">Count: {state.count}</p>
            <button
              onClick={() => update({ $inc: { count: 1 } })}
              data-testid="increment"
            >
              Increment
            </button>
          </div>
        )
      }

      render(<Counter />)

      expect(screen.getByTestId('count')).toHaveTextContent('Count: 0')

      await userEvent.click(screen.getByTestId('increment'))
      expect(screen.getByTestId('count')).toHaveTextContent('Count: 1')

      await userEvent.click(screen.getByTestId('increment'))
      expect(screen.getByTestId('count')).toHaveTextContent('Count: 2')
    })
  })

  describe('useStore Hook', () => {
    it('should work with useStore hook called first', async () => {
      const [store, update] = createStore({ count: 0 })

      function Counter() {
        useStore() // Must be called first!

        return (
          <div>
            <p data-testid="count">Count: {store.count}</p>
            <button
              onClick={() => update({ $inc: { count: 1 } })}
              data-testid="increment"
            >
              Increment
            </button>
          </div>
        )
      }

      render(<Counter />)

      expect(screen.getByTestId('count')).toHaveTextContent('Count: 0')

      await userEvent.click(screen.getByTestId('increment'))
      expect(screen.getByTestId('count')).toHaveTextContent('Count: 1')
    })
  })

  describe('Fine-grained Reactivity', () => {
    it('should only re-render components when accessed properties change', async () => {
      const [store, update] = createStore({ x: 1, y: 2, z: 3 })

      let componentARenders = 0
      let componentBRenders = 0

      function ComponentA() {
        componentARenders++
        const state = useTrackedStore(store)
        // Only re-renders when 'x' changes
        return <div data-testid="x">X: {state.x}</div>
      }

      function ComponentB() {
        componentBRenders++
        const state = useTrackedStore(store)
        // Only re-renders when 'y' changes
        return <div data-testid="y">Y: {state.y}</div>
      }

      function App() {
        return (
          <div>
            <ComponentA />
            <ComponentB />
            <button
              onClick={() => update({ $set: { z: 10 } })}
              data-testid="update-z"
            >
              Update Z
            </button>
            <button
              onClick={() => update({ $set: { x: 5 } })}
              data-testid="update-x"
            >
              Update X
            </button>
          </div>
        )
      }

      render(<App />)

      expect(screen.getByTestId('x')).toHaveTextContent('X: 1')
      expect(screen.getByTestId('y')).toHaveTextContent('Y: 2')
      expect(componentARenders).toBe(1) // Initial render
      expect(componentBRenders).toBe(1) // Initial render

      // Updating 'z' won't re-render ComponentA or ComponentB
      await userEvent.click(screen.getByTestId('update-z'))
      expect(componentARenders).toBe(1) // No additional render
      expect(componentBRenders).toBe(1) // No additional render

      // Updating 'x' should only re-render ComponentA
      await userEvent.click(screen.getByTestId('update-x'))
      expect(screen.getByTestId('x')).toHaveTextContent('X: 5')
      expect(componentARenders).toBe(2) // Re-rendered
      expect(componentBRenders).toBe(1) // Not re-rendered
    })

    it('should handle nested property access correctly', async () => {
      const [store, update] = createStore({
        user: { name: 'John', age: 30, email: 'john@example.com' },
        todos: [],
        settings: { theme: 'dark' },
      })

      let userNameRenders = 0
      let userAgeRenders = 0

      function UserName() {
        userNameRenders++
        const state = useTrackedStore(store)
        // Only subscribes to 'user.name' - won't re-render for age, email, todos, or settings
        return <div data-testid="user-name">{state.user.name}</div>
      }

      function UserAge() {
        userAgeRenders++
        const state = useTrackedStore(store)
        // Only subscribes to 'user.age' - completely independent from UserName component
        return <div data-testid="user-age">{state.user.age}</div>
      }

      function App() {
        return (
          <div>
            <UserName />
            <UserAge />
            <button
              onClick={() => update({ $set: { 'user.age': 31 } })}
              data-testid="update-age"
            >
              Update Age
            </button>
            <button
              onClick={() => update({ $set: { 'settings.theme': 'light' } })}
              data-testid="update-settings"
            >
              Update Settings
            </button>
          </div>
        )
      }

      render(<App />)

      expect(screen.getByTestId('user-name')).toHaveTextContent('John')
      expect(screen.getByTestId('user-age')).toHaveTextContent('30')
      expect(userNameRenders).toBe(1)
      expect(userAgeRenders).toBe(1)

      // This update only re-renders UserAge, not UserName
      await userEvent.click(screen.getByTestId('update-age'))
      expect(screen.getByTestId('user-age')).toHaveTextContent('31')
      expect(userNameRenders).toBe(1) // Not re-rendered
      expect(userAgeRenders).toBe(2) // Re-rendered

      // This update shouldn't re-render either component
      await userEvent.click(screen.getByTestId('update-settings'))
      expect(userNameRenders).toBe(1) // Still not re-rendered
      expect(userAgeRenders).toBe(2) // Still not re-rendered
    })
  })

  describe('For Component - Optimized Array Rendering', () => {
    it('should render arrays optimally with For component', async () => {
      const [store, update] = createStore({
        todos: [
          { id: 1, text: 'Task 1', completed: false },
          { id: 2, text: 'Task 2', completed: true },
        ],
      })

      // Memoized component for each item
      const TodoItem = memo(({ todo, onToggle, onDelete }) => (
        <div
          data-testid={`todo-${todo.id}`}
          className={todo.completed ? 'completed' : 'pending'}
        >
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => onToggle(todo.id)}
            data-testid={`toggle-${todo.id}`}
          />
          <span>{todo.text}</span>
          <button
            onClick={() => onDelete(todo.id)}
            data-testid={`delete-${todo.id}`}
          >
            Delete
          </button>
        </div>
      ))

      function TodoList() {
        const state = useTrackedStore(store)

        const toggleTodo = id => {
          const index = state.todos.findIndex(t => t.id === id)
          update({
            $set: {
              [`todos.${index}.completed`]: !state.todos[index].completed,
            },
          })
        }

        const deleteTodo = id => {
          update({ $pull: { todos: { id } } })
        }

        return (
          <div>
            <h3>Todo List ({state.todos.length})</h3>
            <For
              each={state.todos}
              fallback={
                <p data-testid="no-todos">No todos yet. Add one above!</p>
              }
            >
              {(todo, index) => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onToggle={toggleTodo}
                  onDelete={deleteTodo}
                />
              )}
            </For>
          </div>
        )
      }

      render(<TodoList />)

      expect(screen.getByText('Todo List (2)')).toBeInTheDocument()
      expect(screen.getByTestId('todo-1')).toBeInTheDocument()
      expect(screen.getByTestId('todo-2')).toBeInTheDocument()
      expect(screen.getByTestId('todo-2')).toHaveClass('completed')

      // Toggle first todo
      await userEvent.click(screen.getByTestId('toggle-1'))
      expect(screen.getByTestId('todo-1')).toHaveClass('completed')

      // Delete second todo
      await userEvent.click(screen.getByTestId('delete-2'))
      expect(screen.queryByTestId('todo-2')).not.toBeInTheDocument()
      expect(screen.getByText('Todo List (1)')).toBeInTheDocument()
    })

    it('should show fallback when array is empty', () => {
      const [store] = createStore({ todos: [] })

      function TodoList() {
        const state = useTrackedStore(store)

        return (
          <For
            each={state.todos}
            fallback={<p data-testid="no-todos">No todos yet!</p>}
          >
            {todo => <div key={todo.id}>{todo.text}</div>}
          </For>
        )
      }

      render(<TodoList />)
      expect(screen.getByTestId('no-todos')).toHaveTextContent('No todos yet!')
    })
  })

  describe('Memoized Components Pattern', () => {
    it('should work correctly with memoized components', async () => {
      const [store, update] = createStore({
        tasks: [
          { id: 1, title: 'Task 1', completed: false },
          { id: 2, title: 'Task 2', completed: true },
        ],
        project: { taskIds: [1, 2] },
      })

      let task1Renders = 0
      let task2Renders = 0

      // ✅ Correct - useTrackedStore inside memoized component
      const TaskComponent = memo(({ store, taskId }) => {
        if (taskId === 1) task1Renders++
        if (taskId === 2) task2Renders++

        const state = useTrackedStore(store)
        const task = state.tasks.find(t => t.id === taskId)

        return (
          <div data-testid={`task-${taskId}`}>
            <h3>{task.title}</h3>
            <span>{task.completed ? '✓' : '○'}</span>
            <button
              onClick={() => {
                const index = state.tasks.findIndex(t => t.id === taskId)
                update({
                  $set: {
                    [`tasks.${index}.completed`]: !task.completed,
                  },
                })
              }}
              data-testid={`toggle-${taskId}`}
            >
              Toggle
            </button>
          </div>
        )
      })

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

      expect(screen.getByTestId('task-1')).toBeInTheDocument()
      expect(screen.getByTestId('task-2')).toBeInTheDocument()
      expect(task1Renders).toBe(1)
      expect(task2Renders).toBe(1)

      // Toggle task 1 - both tasks may re-render due to parent re-rendering
      // (This is expected behavior when the parent needs to re-render)
      await userEvent.click(screen.getByTestId('toggle-1'))
      expect(task1Renders).toBeGreaterThan(1) // Re-rendered
      // Task2 might also re-render due to parent update, which is normal
    })
  })

  describe('Complex Example with Multiple Features', () => {
    it('should handle a complex reactive app', async () => {
      const [store, update] = createStore({
        user: { name: 'Alice', score: 0 },
        todos: [],
        settings: { darkMode: false },
        stats: { totalCompleted: 0 },
      })

      function App() {
        const state = useTrackedStore(store)
        const [newTodoText, setNewTodoText] = useState('')

        const addTodo = () => {
          if (!newTodoText.trim()) return
          update({
            $push: {
              todos: {
                id: Date.now(),
                text: newTodoText,
                completed: false,
              },
            },
          })
          setNewTodoText('')
        }

        const toggleTodo = id => {
          const index = state.todos.findIndex(t => t.id === id)
          const todo = state.todos[index]
          const newCompleted = !todo.completed

          update({
            $set: { [`todos.${index}.completed`]: newCompleted },
            $inc: {
              'user.score': newCompleted ? 10 : -10,
              'stats.totalCompleted': newCompleted ? 1 : -1,
            },
          })
        }

        const activeTodos = state.todos.filter(t => !t.completed)
        const completedTodos = state.todos.filter(t => t.completed)

        return (
          <div className={state.settings.darkMode ? 'dark' : 'light'}>
            <header>
              <h1>Welcome {state.user.name}!</h1>
              <p data-testid="score">Score: {state.user.score}</p>
              <p data-testid="stats">
                Total Completed: {state.stats.totalCompleted}
              </p>
              <button
                onClick={() =>
                  update({
                    $set: { 'settings.darkMode': !state.settings.darkMode },
                  })
                }
                data-testid="toggle-theme"
              >
                Toggle {state.settings.darkMode ? 'Light' : 'Dark'} Mode
              </button>
            </header>

            <div>
              <input
                value={newTodoText}
                onChange={e => setNewTodoText(e.target.value)}
                placeholder="New todo..."
                data-testid="new-todo"
              />
              <button onClick={addTodo} data-testid="add-todo">
                Add
              </button>
            </div>

            <div>
              <h2>Active ({activeTodos.length})</h2>
              <div data-testid="active-todos">
                {activeTodos.map(todo => (
                  <div key={todo.id}>
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => toggleTodo(todo.id)}
                    />
                    {todo.text}
                  </div>
                ))}
              </div>

              <h2>Completed ({completedTodos.length})</h2>
              <div data-testid="completed-todos">
                {completedTodos.map(todo => (
                  <div key={todo.id}>
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={() => toggleTodo(todo.id)}
                    />
                    <s>{todo.text}</s>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      }

      render(<App />)

      expect(screen.getByText('Welcome Alice!')).toBeInTheDocument()
      expect(screen.getByTestId('score')).toHaveTextContent('Score: 0')
      expect(screen.getByTestId('stats')).toHaveTextContent(
        'Total Completed: 0'
      )

      // Add a todo
      await userEvent.type(screen.getByTestId('new-todo'), 'Test todo')
      await userEvent.click(screen.getByTestId('add-todo'))

      expect(screen.getByText('Active (1)')).toBeInTheDocument()
      expect(screen.getByText('Test todo')).toBeInTheDocument()

      // Complete the todo
      const checkbox = screen.getByRole('checkbox')
      await userEvent.click(checkbox)

      expect(screen.getByText('Active (0)')).toBeInTheDocument()
      expect(screen.getByText('Completed (1)')).toBeInTheDocument()
      expect(screen.getByTestId('score')).toHaveTextContent('Score: 10')
      expect(screen.getByTestId('stats')).toHaveTextContent(
        'Total Completed: 1'
      )

      // Toggle theme
      await userEvent.click(screen.getByTestId('toggle-theme'))
      expect(screen.getByText('Toggle Light Mode')).toBeInTheDocument()
    })
  })
})
