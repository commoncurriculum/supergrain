import { Document } from '@commoncurriculum/storable'

export interface Todo extends Document {
  id: string
  text: string
  completed: boolean
  createdAt: number
  updatedAt: number
}

export interface UserTodoList extends Document {
  id: string
  userId: string
  firstName: string
  lastName: string
  todos: Todo[]
  createdAt: number
  updatedAt: number
}
