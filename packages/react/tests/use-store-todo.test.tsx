import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { createStore, type ReactiveStore } from '../../core/src'
import { useStore } from '../src'

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

const initialTaskList: UserTaskList = {
  id: 'user-1',
  firstName: 'Jane',
  tasks: [],
}

const TodoListComponent = ({ store }: { store: ReactiveStore }) => {
  const userTaskList = useStore<UserTaskList>(store, 'userTaskList', 'user-1')

  if (!userTaskList) {
    return <div>User not found.</div>
  }

  return (
    <div>
      <h1>{userTaskList.firstName}'s Tasks</h1>
      <ul>
        {userTaskList.tasks.map(task => (
          <li key={task.id}>{task.text}</li>
        ))}
      </ul>
    </div>
  )
}

// --- Tests ---

describe('useStore Hook for Todo App', () => {
  it('should re-render the component when a new todo is added', () => {
    const store = createStore()
    store.set('userTaskList', initialTaskList.id, { ...initialTaskList, tasks: [] })

    render(<TodoListComponent store={store} />)

    // Initially, no tasks should be present
    expect(screen.queryByText('Learn TDD')).toBeNull()

    // Create and add a new task
    const newTask: Task = {
      id: 'task-1',
      isCompleted: false,
      text: 'Learn TDD',
    }

    // Use `act` to wrap the state update
    act(() => {
      const userTaskList = store.find<UserTaskList>('userTaskList', 'user-1')
      userTaskList?.tasks.push(newTask)
    })

    // After the update, the new task should be rendered
    expect(screen.getByText('Learn TDD')).not.toBeNull()
  })
})
