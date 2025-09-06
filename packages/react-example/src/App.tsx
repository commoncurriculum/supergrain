import React, { useState } from 'react'
import { useTrackedStore } from '@storable/react'
import { store, update } from './store'
import TaskItem from './TaskItem'

function App() {
  const state = useTrackedStore(store)
  const [inputText, setInputText] = useState('')

  const addTask = () => {
    if (!inputText.trim()) return

    update({
      $push: {
        tasks: {
          id: Date.now().toString(),
          text: inputText,
          completed: false,
        },
      },
    })

    setInputText('')
  }

  const toggleTask = (id: string) => {
    const index = state.tasks.findIndex(t => t.id === id)
    if (index !== -1) {
      update({
        $set: {
          [`tasks.${index}.completed`]: !state.tasks[index].completed,
        },
      })
    }
  }

  const deleteTask = (id: string) => {
    update({
      $pull: { tasks: { id } },
    })
  }

  const clearCompleted = () => {
    const activeTasks = state.tasks.filter(t => !t.completed)
    update({
      $set: { tasks: activeTasks },
    })
  }

  return (
    <div>
      <h1>{state.firstName ? `${state.firstName}'s` : 'My'} TODO List</h1>

      <div>
        <label>
          Name:{' '}
          <input
            value={state.firstName}
            onChange={e => update({ $set: { firstName: e.target.value } })}
            placeholder="Enter your name"
          />
        </label>
      </div>

      <div>
        <input
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && addTask()}
          placeholder="What needs to be done?"
        />
        <button onClick={addTask}>Add</button>
      </div>

      {/* Filters */}
      <div>
        {(['all', 'active', 'completed'] as const).map(filterType => (
          <button
            key={filterType}
            style={{
              fontWeight: state.filter === filterType ? 'bold' : 'normal',
            }}
            onClick={() => update({ $set: { filter: filterType } })}
          >
            {filterType}
          </button>
        ))}
      </div>

      {/* Task list */}
      <ul>
        {state.tasks.map((task, index) => {
          const isVisible =
            state.filter === 'all' ||
            (state.filter === 'active' && !task.completed) ||
            (state.filter === 'completed' && task.completed)

          return isVisible ? (
            <TaskItem
              key={task.id}
              id={task.id}
              index={index}
              toggleTask={toggleTask}
              deleteTask={deleteTask}
            />
          ) : null
        })}
      </ul>

      {/* Clear completed */}
      {state.tasks.some(t => t.completed) && (
        <button onClick={clearCompleted}>Clear Completed</button>
      )}
    </div>
  )
}

export default App
