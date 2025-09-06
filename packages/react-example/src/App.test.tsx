import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { store, update } from './store'

describe('App', () => {
  beforeEach(() => {
    // Reset the store state before each test
    update({ $set: { tasks: [], firstName: '' } })
  })

  test('renders the default header', () => {
    render(<App />)
    expect(
      screen.getByRole('heading', { name: /my todo list/i })
    ).toBeInTheDocument()
  })

  test('should update the header when the user enters a name', async () => {
    const user = userEvent.setup()
    render(<App />)

    const nameInput = screen.getByPlaceholderText('Enter your name')
    await user.type(nameInput, 'John')

    expect(
      screen.getByRole('heading', { name: /john's todo list/i })
    ).toBeInTheDocument()
  })

  test('should add a new task and display it on the screen', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Find input and button
    const input = screen.getByPlaceholderText('What needs to be done?')
    const addButton = screen.getByRole('button', { name: /add/i })

    // Type a new task and click add
    await user.type(input, 'My first task')
    await user.click(addButton)

    // Assert the new task is in the document
    expect(screen.getByText('My first task')).toBeInTheDocument()

    // Assert the input is cleared
    expect(input).toHaveValue('')
  })

  test('should add a new task by pressing Enter', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByPlaceholderText('What needs to be done?')

    await user.type(input, 'A second task{enter}')

    expect(screen.getByText('A second task')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  test('should not add an empty task', async () => {
    const user = userEvent.setup()
    render(<App />)

    const addButton = screen.getByRole('button', { name: /add/i })

    // Click add without typing anything
    await user.click(addButton)

    // Assert that the list is still empty
    const list = screen.getByRole('list')
    expect(list.children.length).toBe(0)
  })

  test('should toggle the completed status of a task', async () => {
    const user = userEvent.setup()
    render(<App />)

    const input = screen.getByPlaceholderText('What needs to be done?')
    await user.type(input, 'Task to toggle{enter}')

    const taskText = screen.getByText('Task to toggle')
    const checkbox = screen.getByRole('checkbox')

    // Initially not completed
    expect(checkbox).not.toBeChecked()
    expect(window.getComputedStyle(taskText).textDecoration).not.toContain(
      'line-through'
    )

    // Toggle to completed
    await user.click(checkbox)
    await waitFor(() => {
      expect(checkbox).toBeChecked()
      expect(window.getComputedStyle(taskText).textDecoration).toContain(
        'line-through'
      )
    })

    // Toggle back to not completed
    await user.click(checkbox)
    await waitFor(() => {
      expect(checkbox).not.toBeChecked()
      expect(window.getComputedStyle(taskText).textDecoration).not.toContain(
        'line-through'
      )
    })
  })

  test('should delete a task', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Add a task
    const input = screen.getByPlaceholderText('What needs to be done?')
    await user.type(input, 'Task to delete{enter}')

    const taskText = screen.getByText('Task to delete')
    expect(taskText).toBeInTheDocument()

    // Delete the task
    const deleteButton = screen.getByRole('button', { name: /delete/i })
    await user.click(deleteButton)

    // Assert the task is no longer in the document
    expect(taskText).not.toBeInTheDocument()
  })

  describe('Filtering and Clearing', () => {
    beforeEach(() => {
      // Create a mix of active and completed tasks
      update({
        $set: {
          tasks: [
            { id: '1', text: 'Active Task 1', completed: false },
            { id: '2', text: 'Completed Task 1', completed: true },
            { id: '3', text: 'Active Task 2', completed: false },
            { id: '4', text: 'Completed Task 2', completed: true },
          ],
        },
      })
    })

    test('should filter for active tasks', async () => {
      const user = userEvent.setup()
      render(<App />)
      const activeButton = screen.getByRole('button', { name: /active/i })
      await user.click(activeButton)

      expect(screen.getByText('Active Task 1')).toBeInTheDocument()
      expect(screen.getByText('Active Task 2')).toBeInTheDocument()
      expect(screen.queryByText('Completed Task 1')).not.toBeInTheDocument()
      expect(screen.queryByText('Completed Task 2')).not.toBeInTheDocument()
    })

    test('should filter for completed tasks', async () => {
      const user = userEvent.setup()
      render(<App />)
      const completedButton = screen.getByRole('button', { name: /completed/i })
      await user.click(completedButton)

      expect(screen.queryByText('Active Task 1')).not.toBeInTheDocument()
      expect(screen.queryByText('Active Task 2')).not.toBeInTheDocument()
      expect(screen.getByText('Completed Task 1')).toBeInTheDocument()
      expect(screen.getByText('Completed Task 2')).toBeInTheDocument()
    })

    test('should show all tasks when "all" is clicked', async () => {
      const user = userEvent.setup()
      render(<App />)

      // First filter to something else
      const activeButton = screen.getByRole('button', { name: /active/i })
      await user.click(activeButton)

      // Then click all
      const allButton = screen.getByRole('button', { name: /all/i })
      await user.click(allButton)

      expect(screen.getByText('Active Task 1')).toBeInTheDocument()
      expect(screen.getByText('Active Task 2')).toBeInTheDocument()
      expect(screen.getByText('Completed Task 1')).toBeInTheDocument()
      expect(screen.getByText('Completed Task 2')).toBeInTheDocument()
    })

    test('should clear completed tasks', async () => {
      const user = userEvent.setup()
      render(<App />)

      const clearButton = screen.getByRole('button', {
        name: /clear completed/i,
      })
      expect(clearButton).toBeInTheDocument()

      await user.click(clearButton)

      expect(screen.getByText('Active Task 1')).toBeInTheDocument()
      expect(screen.getByText('Active Task 2')).toBeInTheDocument()
      expect(screen.queryByText('Completed Task 1')).not.toBeInTheDocument()
      expect(screen.queryByText('Completed Task 2')).not.toBeInTheDocument()
      expect(clearButton).not.toBeInTheDocument()
    })
  })
})
