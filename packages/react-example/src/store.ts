import { createStore } from '@storable/core'

// Types
export interface Task {
  id: string
  text: string
  completed: boolean
}

export interface UserTaskList {
  firstName: string
  tasks: Task[]
  filter: 'all' | 'active' | 'completed'
}

// Create store
const [store, update] = createStore<UserTaskList>({
  firstName: '',
  tasks: [],
  filter: 'all',
})

export { store, update }
