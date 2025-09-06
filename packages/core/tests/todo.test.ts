import { describe, it, expect } from 'vitest'
import { createStore } from '../src'

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

interface AppState {
  userTaskList: UserTaskList
}

describe('Todo App Core Tests', () => {
  it('should add a todo to the tasks array using $push', () => {
    const initialState: AppState = {
      userTaskList: {
        id: 'user-1',
        firstName: 'John',
        tasks: [],
      },
    }

    const [state, update] = createStore(initialState)

    const newTask: Task = {
      id: 'task-1',
      isCompleted: false,
      text: 'Write tests based on USAGE.md',
    }

    update({
      $push: {
        'userTaskList.tasks': newTask,
      },
    })

    expect(state.userTaskList.tasks.length).toBe(1)
    expect(state.userTaskList.tasks[0]).toEqual(newTask)
  })
})
