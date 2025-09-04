import { useDocument } from '@commoncurriculum/storable/react'
import { store, addTodoToUserList } from '../store'
import type { UserTodoList } from '../types'
import { AddTodo } from './AddTodo'
import { TodoItem } from './TodoItem'

interface TodoListProps {
  userId: string
}

export function TodoListComponent({ userId }: TodoListProps) {
  const userTodoList = useDocument<UserTodoList>(store, 'userTodoList', userId)

  if (!userTodoList) {
    return <div>Loading...</div>
  }

  const handleAddTodo = (todoText: string) => {
    addTodoToUserList(userId, todoText)
  }

  const completedCount = userTodoList.todos.filter(
    todo => todo.completed
  ).length
  const totalCount = userTodoList.todos.length

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">Todo List</h2>
        <div className="text-sm text-gray-500 mt-1">
          {completedCount} of {totalCount} completed
        </div>
      </div>

      <div className="p-6">
        <AddTodo onAdd={handleAddTodo} />

        <div className="mt-6 space-y-2">
          {userTodoList.todos.map(todo => (
            <TodoItem key={todo.id} todo={todo} userId={userId} />
          ))}

          {userTodoList.todos.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No todos yet. Add one above!
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
