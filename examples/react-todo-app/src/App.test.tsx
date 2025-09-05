import { render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import App from './App'
import { store } from './store'

describe('Todo App', () => {
  beforeEach(() => {
    // Clear the store before each test to ensure test isolation
    const documentStore = store as any
    documentStore.documents?.clear()
    documentStore.proxies?.clear()
    documentStore.subscribers?.clear()
  })

  test('renders todo app with default todos', async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('React Todo App')).toBeInTheDocument()
    })

    expect(screen.getByText("Scott AM's Todo List")).toBeInTheDocument()
    expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    expect(screen.getByText('Build a todo app')).toBeInTheDocument()
    expect(screen.getByText('Deploy to production')).toBeInTheDocument()
  })

  test('adds a new todo', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('React Todo App')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('What needs to be done?')
    const addButton = screen.getByRole('button', { name: /add/i })

    await user.type(input, 'New test todo')
    await user.click(addButton)

    await waitFor(() => {
      expect(screen.getByText('New test todo')).toBeInTheDocument()
    })

    // Check that the input is cleared
    expect(input).toHaveValue('')
  })

  test('toggles todo completion', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })

    const checkbox = screen.getAllByRole('checkbox')[0]
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)

    await waitFor(() => {
      expect(checkbox).toBeChecked()
    })

    // Check if the text has line-through styling (completed state)
    const todoText = screen.getByText('Learn React basics')
    expect(todoText).toHaveClass('line-through')
  })

  test('edits todo text by double-clicking', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })

    const todoText = screen.getByText('Learn React basics')
    await user.dblClick(todoText)

    // Should show edit input
    const editInput = screen.getByDisplayValue('Learn React basics')
    expect(editInput).toBeInTheDocument()

    await user.clear(editInput)
    await user.type(editInput, 'Updated todo text')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Updated todo text')).toBeInTheDocument()
    })
    expect(screen.queryByText('Learn React basics')).not.toBeInTheDocument()
  })

  test('edits todo text by clicking edit button', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })

    const editButton = screen.getAllByTitle('Edit')[0]
    await user.click(editButton)

    // Should show edit input
    const editInput = screen.getByDisplayValue('Learn React basics')
    expect(editInput).toBeInTheDocument()

    await user.clear(editInput)
    await user.type(editInput, 'Edited via button')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(screen.getByText('Edited via button')).toBeInTheDocument()
    })
  })

  test('cancels edit on Escape key', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })

    const todoText = screen.getByText('Learn React basics')
    await user.dblClick(todoText)

    const editInput = screen.getByDisplayValue('Learn React basics')
    await user.clear(editInput)
    await user.type(editInput, 'This should be cancelled')
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('This should be cancelled')
    ).not.toBeInTheDocument()
  })

  test('deletes a todo', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })

    const deleteButton = screen.getAllByTitle('Delete')[0]
    await user.click(deleteButton)

    await waitFor(() => {
      expect(screen.queryByText('Learn React basics')).not.toBeInTheDocument()
    })
  })

  test('updates completion counter correctly', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('0 of 3 completed')).toBeInTheDocument()
    })

    // Complete first todo
    const firstCheckbox = screen.getAllByRole('checkbox')[0]
    await user.click(firstCheckbox)

    await waitFor(() => {
      expect(screen.getByText('1 of 3 completed')).toBeInTheDocument()
    })

    // Complete second todo
    const secondCheckbox = screen.getAllByRole('checkbox')[1]
    await user.click(secondCheckbox)

    await waitFor(() => {
      expect(screen.getByText('2 of 3 completed')).toBeInTheDocument()
    })
  })

  test('prevents adding empty todos', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('React Todo App')).toBeInTheDocument()
    })

    const input = screen.getByPlaceholderText('What needs to be done?')
    const addButton = screen.getByRole('button', { name: /add/i })

    // Try to add empty todo
    await user.type(input, '   ') // Just spaces
    expect(addButton).toBeDisabled()

    await user.clear(input)
    expect(addButton).toBeDisabled()
  })

  test('prevents editing todo to empty text', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })

    const todoText = screen.getByText('Learn React basics')
    await user.dblClick(todoText)

    const editInput = screen.getByDisplayValue('Learn React basics')
    await user.clear(editInput)
    await user.type(editInput, '   ') // Just spaces
    await user.keyboard('{Enter}')

    // Should cancel edit and keep original text
    await waitFor(() => {
      expect(screen.getByText('Learn React basics')).toBeInTheDocument()
    })
  })
})
