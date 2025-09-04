import { useState, FormEvent } from 'react'

interface AddTodoProps {
  onAdd: (todoText: string) => void
}

export function AddTodo({ onAdd }: AddTodoProps) {
  const [text, setText] = useState('')
  const [isAdding, setIsAdding] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    const trimmedText = text.trim()
    if (!trimmedText || isAdding) return

    setIsAdding(true)

    try {
      // Notify parent to add to list
      onAdd(trimmedText)

      // Reset form
      setText('')
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <form className="flex gap-3" onSubmit={handleSubmit}>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What needs to be done?"
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={isAdding}
      />
      <button
        type="submit"
        className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={!text.trim() || isAdding}
      >
        {isAdding ? 'Adding...' : 'Add'}
      </button>
    </form>
  )
}
