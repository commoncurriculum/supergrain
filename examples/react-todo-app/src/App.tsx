import { useEffect } from 'react'
import { useDocument } from '@commoncurriculum/storable/react'
import { store, createUserTodoList } from './store'
import type { UserTodoList } from './types'
import { TodoListComponent } from './components/TodoList'

const DEFAULT_USER_ID = 'user-1'

function App() {
  const defaultUserList = createUserTodoList(DEFAULT_USER_ID, 'Scott', 'AM')
  store.setDocument('userTodoList', DEFAULT_USER_ID, defaultUserList)

  const userTodoList = useDocument<UserTodoList>(
    store,
    'userTodoList',
    DEFAULT_USER_ID
  )

  // Initialize the default user todo list if it doesn't exist

  if (!userTodoList) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-lg text-gray-600 animate-pulse">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200 py-6">
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="text-3xl font-bold text-gray-900">React Todo App</h1>
          <p className="text-sm text-gray-600 mt-1">
            Built with @commoncurriculum/storable
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {userTodoList.firstName} {userTodoList.lastName}'s Todo List
          </p>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-4 py-8">
        <TodoListComponent userId={DEFAULT_USER_ID} />
      </main>
    </div>
  )
}

export default App
