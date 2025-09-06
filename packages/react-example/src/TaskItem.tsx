import React from 'react'
import { useTrackedStore } from '@storable/react'
import { store } from './store'

interface TaskItemProps {
  id: string
  index: number
  toggleTask: (id: string) => void
  deleteTask: (id: string) => void
}

function TaskItem({ id, index, toggleTask, deleteTask }: TaskItemProps) {
  const state = useTrackedStore(store)

  // By accessing the specific properties of the task at this index,
  // this component subscribes to changes on ONLY those properties.
  // This is the key to fine-grained reactivity.
  const task = state.tasks[index]

  // If the task doesn't exist for some reason (e.g., deleted in a race condition),
  // don't render anything.
  if (!task) {
    return null
  }

  return (
    <li>
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => toggleTask(id)}
      />
      <span
        style={{
          textDecoration: task.completed ? 'line-through' : 'none',
        }}
      >
        {task.text}
      </span>
      <button onClick={() => deleteTask(id)}>Delete</button>
    </li>
  )
}

export default TaskItem
