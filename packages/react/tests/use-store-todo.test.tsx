import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { createStore } from '../../core/src'
import { useTrackedStore } from '../src'

// --- Test Setup ---

interface Task {
  id: string
  isCompleted: boolean
  text: string
}

interface UserTaskList {
  id: string
  firstName: string
  tasks: Array<Task>
}

const TodoItem = ({ task }: { task: Task }) => {
  const trackedTask = useTrackedStore(task)
  return (
    <li
      style={{
        textDecoration: trackedTask.isCompleted ? 'line-through' : 'none',
      }}
    >
      {trackedTask.text}
    </li>
  )
}

const TodoListComponent = ({ store }: { store: UserTaskList }) => {
  const state = useTrackedStore(store)

  return (
    <div>
      <h1>{state.firstName}'s Tasks</h1>
      <ul>
        {state.tasks.map(task => (
          <TodoItem key={task.id} task={task} />
        ))}
      </ul>
    </div>
  )
}

// --- Tests ---

describe('useTrackedStore Hook for Todo App', () => {
  it('should re-render the component when a new todo is added', () => {
    const initialState: UserTaskList = {
      id: 'user-1',
      firstName: 'Jane',
      tasks: [],
    }
    const [store, update] = createStore(initialState)

    render(<TodoListComponent store={store} />)

    // Initially, no tasks should be present
    expect(screen.queryByText('Learn TDD')).toBeNull()

    // Create a new task
    const newTask: Task = {
      id: 'task-1',
      isCompleted: false,
      text: 'Learn TDD',
    }

    // Use `act` to wrap the state update
    act(() => {
      update({
        $push: {
          tasks: newTask,
        },
      })
    })

    // After the update, the new task should be rendered
    expect(screen.getByText('Learn TDD')).not.toBeNull()
  })

  it('should re-render and remove a todo when using $pull', () => {
    const initialTasks: Task[] = [
      { id: 'task-1', isCompleted: false, text: 'First task' },
      { id: 'task-2', isCompleted: false, text: 'Second task' },
    ]
    const initialState: UserTaskList = {
      id: 'user-1',
      firstName: 'Jane',
      tasks: initialTasks,
    }
    const [store, update] = createStore(initialState)

    render(<TodoListComponent store={store} />)

    // Both tasks should be visible initially
    expect(screen.getByText('First task')).not.toBeNull()
    expect(screen.getByText('Second task')).not.toBeNull()

    // Remove the first task
    act(() => {
      update({
        $pull: {
          tasks: { id: 'task-1' },
        },
      })
    })

    // The first task should be gone, the second should remain
    expect(screen.queryByText('First task')).toBeNull()
    expect(screen.getByText('Second task')).not.toBeNull()
  })

  it('should re-render and update a todo text when using $set', () => {
    const initialTasks: Task[] = [
      { id: 'task-1', isCompleted: false, text: 'Original text' },
      { id: 'task-2', isCompleted: false, text: 'Another item' },
    ]
    const initialState: UserTaskList = {
      id: 'user-1',
      firstName: 'Jane',
      tasks: initialTasks,
    }
    const [store, update] = createStore(initialState)

    render(<TodoListComponent store={store} />)

    // Initial text should be there
    expect(screen.getByText('Original text')).not.toBeNull()

    const newText = 'This text has been updated'
    // Update the text of the first task
    act(() => {
      update({
        $set: {
          'tasks.0.text': newText,
        },
      })
    })

    // The old text should be gone, and the new text should be present
    expect(screen.queryByText('Original text')).toBeNull()
    expect(screen.getByText(newText)).not.toBeNull()
    // The other task should be unaffected
    expect(screen.getByText('Another item')).not.toBeNull()
  })

  it('should mark a todo as completed and update the style', () => {
    const initialTasks: Task[] = [
      { id: 'task-1', isCompleted: false, text: 'Incomplete Task' },
    ]
    const initialState: UserTaskList = {
      id: 'user-1',
      firstName: 'Jane',
      tasks: initialTasks,
    }
    const [store, update] = createStore(initialState)

    render(<TodoListComponent store={store} />)

    const taskElement = screen.getByText('Incomplete Task')
    expect(taskElement.style.textDecoration).toBe('none')

    // Mark the task as completed
    act(() => {
      update({
        $set: {
          'tasks.0.isCompleted': true,
        },
      })
    })

    expect(taskElement.style.textDecoration).toBe('line-through')
  })
})
