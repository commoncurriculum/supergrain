import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DocumentStore, update } from '../DocumentStore'
import type { Document } from '../../types'

interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: number
  updatedAt: number
}

interface TodoList extends Document {
  name: string
  todos: Todo[]
  tags: string[]
  metadata: {
    nested: {
      items: number[]
    }
  }
}

interface User extends Document {
  name: string
  hobbies: string[]
  friends: Array<{ id: string; name: string }>
}

describe('DocumentStore - Patch Operations ($push, $pull)', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = new DocumentStore()
  })

  describe('$push operation', () => {
    it('should push primitive values to array', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$push', path: 'hobbies', value: 'gaming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', 'gaming'])
    })

    it('should push objects to array', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: [],
        friends: [{ id: 'friend1', name: 'Alice' }],
      }

      store.setDocument('user', 'user1', user)

      const newFriend = { id: 'friend2', name: 'Bob' }
      update(store, 'user', 'user1', [
        { op: '$push', path: 'friends', value: newFriend },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.friends).toEqual([
        { id: 'friend1', name: 'Alice' },
        { id: 'friend2', name: 'Bob' },
      ])
    })

    it('should push complex objects to array (Todo example)', () => {
      const todoList: TodoList = {
        id: 'list1',
        name: 'My Todos',
        todos: [],
        tags: [],
        metadata: { nested: { items: [] } },
      }

      store.setDocument('todoList', 'list1', todoList)

      const newTodo: Todo = {
        id: 'todo1',
        text: 'Learn testing',
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      update(store, 'todoList', 'list1', [
        { op: '$push', path: 'todos', value: newTodo },
      ])

      const updated = store.getDocument('todoList', 'list1')
      expect(updated.todos).toHaveLength(1)
      expect(updated.todos[0]).toEqual(newTodo)
    })

    it.skip('should trigger signal updates when pushing', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal('user', 'user1')
      const callback = vi.fn()
      signal.subscribe(callback)

      // Reset to ignore initial subscription call
      callback.mockReset()

      update(store, 'user', 'user1', [
        { op: '$push', path: 'hobbies', value: 'gaming' },
      ])

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          hobbies: ['reading', 'gaming'],
        })
      )
    })

    it('should handle pushing to empty arrays', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: [],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$push', path: 'hobbies', value: 'first hobby' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['first hobby'])
    })

    it('should handle multiple $push operations in single update', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: [],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$push', path: 'hobbies', value: 'reading' },
        { op: '$push', path: 'hobbies', value: 'gaming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', 'gaming'])
    })

    it('should handle pushing null and undefined values', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$push', path: 'hobbies', value: null },
        { op: '$push', path: 'hobbies', value: undefined },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', null, undefined])
    })

    it('should not modify original array reference', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)
      const originalHobbies = store.getDocument('user', 'user1').hobbies

      update(store, 'user', 'user1', [
        { op: '$push', path: 'hobbies', value: 'gaming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).not.toBe(originalHobbies)
      expect(originalHobbies).toEqual(['reading']) // Original unchanged
      expect(updated.hobbies).toEqual(['reading', 'gaming'])
    })
  })

  describe('$pull operation', () => {
    it('should pull primitive values from array', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading', 'gaming', 'cooking'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'gaming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', 'cooking'])
    })

    it('should pull objects by ID from array', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: [],
        friends: [
          { id: 'friend1', name: 'Alice' },
          { id: 'friend2', name: 'Bob' },
          { id: 'friend3', name: 'Charlie' },
        ],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        {
          op: '$pull',
          path: 'friends',
          value: { id: 'friend2', name: 'Bob' },
        },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.friends).toHaveLength(2)
      expect(updated.friends.find(f => f.id === 'friend2')).toBeUndefined()
      expect(updated.friends).toEqual([
        { id: 'friend1', name: 'Alice' },
        { id: 'friend3', name: 'Charlie' },
      ])
    })

    it('should pull objects by deep equality (JSON comparison)', () => {
      const todoList: TodoList = {
        id: 'list1',
        name: 'My Todos',
        todos: [
          {
            id: 'todo1',
            text: 'Task 1',
            completed: false,
            createdAt: 1000,
            updatedAt: 1000,
          },
          {
            id: 'todo2',
            text: 'Task 2',
            completed: true,
            createdAt: 2000,
            updatedAt: 2000,
          },
        ],
        tags: [],
        metadata: { nested: { items: [] } },
      }

      store.setDocument('todoList', 'list1', todoList)
      const todoToRemove = todoList.todos[0]

      update(store, 'todoList', 'list1', [
        { op: '$pull', path: 'todos', value: todoToRemove },
      ])

      const updated = store.getDocument('todoList', 'list1')
      expect(updated.todos).toHaveLength(1)
      expect(updated.todos[0].id).toBe('todo2')
    })

    it.skip('should trigger signal updates when pulling', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading', 'gaming'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)
      const signal = store.getDocumentSignal('user', 'user1')
      const callback = vi.fn()
      signal.subscribe(callback)

      // Reset to ignore initial subscription call
      callback.mockReset()

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'gaming' },
      ])

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          hobbies: ['reading'],
        })
      )
    })

    it('should handle pulling non-existent values gracefully', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading', 'gaming'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'nonexistent' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', 'gaming']) // Unchanged
    })

    it('should handle pulling from empty arrays', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: [],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'anything' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual([])
    })

    it('should handle multiple $pull operations in single update', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading', 'gaming', 'cooking', 'swimming'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'gaming' },
        { op: '$pull', path: 'hobbies', value: 'swimming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', 'cooking'])
    })

    it('should not modify original array reference', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading', 'gaming'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)
      const originalHobbies = store.getDocument('user', 'user1').hobbies

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'gaming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).not.toBe(originalHobbies)
      expect(originalHobbies).toEqual(['reading', 'gaming']) // Original unchanged
      expect(updated.hobbies).toEqual(['reading'])
    })
  })

  describe('combined $push and $pull operations', () => {
    it('should handle $push and $pull in single update', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading', 'gaming'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      update(store, 'user', 'user1', [
        { op: '$pull', path: 'hobbies', value: 'gaming' },
        { op: '$push', path: 'hobbies', value: 'cooking' },
        { op: '$push', path: 'hobbies', value: 'swimming' },
      ])

      const updated = store.getDocument('user', 'user1')
      expect(updated.hobbies).toEqual(['reading', 'cooking', 'swimming'])
    })

    it('should handle $push and $pull with $set operations', () => {
      const todoList: TodoList = {
        id: 'list1',
        name: 'My Todos',
        todos: [
          {
            id: 'todo1',
            text: 'Old task',
            completed: false,
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
        tags: ['work'],
        metadata: { nested: { items: [] } },
      }

      store.setDocument('todoList', 'list1', todoList)

      const newTodo: Todo = {
        id: 'todo2',
        text: 'New task',
        completed: false,
        createdAt: 2000,
        updatedAt: 2000,
      }

      update(store, 'todoList', 'list1', [
        { op: '$push', path: 'todos', value: newTodo },
        { op: '$push', path: 'tags', value: 'personal' },
        { op: '$set', path: 'name', value: 'Updated Todos' },
      ])

      const updated = store.getDocument('todoList', 'list1')
      expect(updated.name).toBe('Updated Todos')
      expect(updated.todos).toHaveLength(2)
      expect(updated.todos[1]).toEqual(newTodo)
      expect(updated.tags).toEqual(['work', 'personal'])
    })
  })

  describe('edge cases and error scenarios', () => {
    it('should handle operations on non-array properties gracefully', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      // Try to push to a string property - should not crash
      expect(() => {
        update(store, 'user', 'user1', [
          { op: '$push', path: 'name', value: 'suffix' },
        ])
      }).not.toThrow()

      // The document should remain unchanged
      const updated = store.getDocument('user', 'user1')
      expect(updated.name).toBe('John')
    })

    it('should handle operations on non-existent paths gracefully', () => {
      const user: User = {
        id: 'user1',
        name: 'John',
        hobbies: ['reading'],
        friends: [],
      }

      store.setDocument('user', 'user1', user)

      // Try to push to non-existent property - should not crash
      expect(() => {
        update(store, 'user', 'user1', [
          { op: '$push', path: 'nonExistent', value: 'value' },
        ])
      }).not.toThrow()

      // The document should remain unchanged
      const updated = store.getDocument('user', 'user1')
      expect(updated).toEqual(user)
    })

    it.skip('should maintain deep signal reactivity after array operations', () => {
      const todoList: TodoList = {
        id: 'list1',
        name: 'My Todos',
        todos: [],
        tags: [],
        metadata: { nested: { items: [1, 2, 3] } },
      }

      store.setDocument('todoList', 'list1', todoList)
      const callback = vi.fn()

      // Subscribe to the document
      const documentSignal = store.getDocumentSignal('todoList', 'list1')
      documentSignal.subscribe(callback)
      callback.mockReset()

      // Perform multiple array operations
      const newTodo: Todo = {
        id: 'todo1',
        text: 'Test task',
        completed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      update(store, 'todoList', 'list1', [
        { op: '$push', path: 'todos', value: newTodo },
        { op: '$push', path: 'tags', value: 'test' },
      ])

      // Should trigger exactly once for the combined update
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          todos: [newTodo],
          tags: ['test'],
        })
      )
    })
  })

  describe('real-world usage scenarios', () => {
    it('should support todo app operations (add, remove, update)', () => {
      // This mirrors the exact usage in the React todo app
      const todoList: TodoList = {
        id: 'user123',
        name: 'My Todo List',
        todos: [
          {
            id: 'todo1',
            text: 'Learn React',
            completed: false,
            createdAt: 1000,
            updatedAt: 1000,
          },
        ],
        tags: [],
        metadata: { nested: { items: [] } },
      }

      store.setDocument('userTodoList', 'user123', todoList)

      // Add a new todo
      const newTodo: Todo = {
        id: 'todo2',
        text: 'Build todo app',
        completed: false,
        createdAt: 2000,
        updatedAt: 2000,
      }

      update(store, 'userTodoList', 'user123', [
        { op: '$push', path: 'todos', value: newTodo },
        { op: '$set', path: 'updatedAt', value: 2000 },
      ])

      let updated = store.getDocument('userTodoList', 'user123')
      expect(updated.todos).toHaveLength(2)

      // Remove a todo by finding and pulling the exact object
      const todoToRemove = updated.todos.find(t => t.id === 'todo1')
      expect(todoToRemove).toBeDefined()

      update(store, 'userTodoList', 'user123', [
        { op: '$pull', path: 'todos', value: todoToRemove },
        { op: '$set', path: 'updatedAt', value: 3000 },
      ])

      updated = store.getDocument('userTodoList', 'user123')
      expect(updated.todos).toHaveLength(1)
      expect(updated.todos[0].id).toBe('todo2')
    })

    it('should maintain performance with multiple rapid operations', () => {
      const todoList: TodoList = {
        id: 'list1',
        name: 'Performance Test',
        todos: [],
        tags: [],
        metadata: { nested: { items: [] } },
      }

      store.setDocument('todoList', 'list1', todoList)

      const startTime = performance.now()

      // Add 100 todos rapidly
      for (let i = 0; i < 100; i++) {
        const newTodo: Todo = {
          id: `todo${i}`,
          text: `Task ${i}`,
          completed: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        update(store, 'todoList', 'list1', [
          { op: '$push', path: 'todos', value: newTodo },
        ])
      }

      const updated = store.getDocument('todoList', 'list1')
      expect(updated.todos).toHaveLength(100)

      const endTime = performance.now()
      const duration = endTime - startTime

      // Should complete in reasonable time (adjust threshold as needed)
      expect(duration).toBeLessThan(1000) // 1 second max for 100 operations
    })
  })
})
