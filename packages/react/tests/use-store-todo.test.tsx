import { createStore } from "@supergrain/core";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect } from "vitest";

import { tracked } from "../src";
import { flushMicrotasks } from "./test-utils";

// --- Test Setup ---

interface Task {
  id: string;
  isCompleted: boolean;
  text: string;
}

interface UserTaskList {
  id: string;
  firstName: string;
  tasks: Array<Task>;
}

const TodoItem = tracked(({ task }: { task: Task }) => {
  return (
    <li
      style={{
        textDecoration: task.isCompleted ? "line-through" : "none",
      }}
    >
      {task.text}
    </li>
  );
});

const TodoListComponent = tracked(({ store }: { store: UserTaskList }) => {
  return (
    <div>
      <h1>{store.firstName}&apos;s Tasks</h1>
      <ul>
        {store.tasks.map((task) => (
          <TodoItem key={task.id} task={task} />
        ))}
      </ul>
    </div>
  );
});

// --- Tests ---

describe("tracked() for Todo App", () => {
  it("should re-render the component when a new todo is added", async () => {
    const initialState: UserTaskList = {
      id: "user-1",
      firstName: "Jane",
      tasks: [],
    };
    const [store, update] = createStore(initialState);

    render(<TodoListComponent store={store} />);

    // Initially, no tasks should be present
    expect(screen.queryByText("Learn TDD")).toBeNull();

    // Create a new task
    const newTask: Task = {
      id: "task-1",
      isCompleted: false,
      text: "Learn TDD",
    };

    // Use `act` to wrap the state update
    await act(async () => {
      update({
        $push: {
          tasks: newTask,
        },
      });
      await flushMicrotasks();
    });

    // After the update, the new task should be rendered
    expect(screen.getByText("Learn TDD")).not.toBeNull();
  });

  it("should re-render and remove a todo when using $pull", async () => {
    const initialTasks: Task[] = [
      { id: "task-1", isCompleted: false, text: "First task" },
      { id: "task-2", isCompleted: false, text: "Second task" },
    ];
    const initialState: UserTaskList = {
      id: "user-1",
      firstName: "Jane",
      tasks: initialTasks,
    };
    const [store, update] = createStore(initialState);

    render(<TodoListComponent store={store} />);

    // Both tasks should be visible initially
    expect(screen.getByText("First task")).not.toBeNull();
    expect(screen.getByText("Second task")).not.toBeNull();

    // Remove the first task
    await act(async () => {
      update({
        $pull: {
          tasks: { id: "task-1" },
        },
      });
      await flushMicrotasks();
    });

    // The first task should be gone, the second should remain
    expect(screen.queryByText("First task")).toBeNull();
    expect(screen.getByText("Second task")).not.toBeNull();
  });

  it("should re-render and update a todo text when using $set", async () => {
    const initialTasks: Task[] = [
      { id: "task-1", isCompleted: false, text: "Original text" },
      { id: "task-2", isCompleted: false, text: "Another item" },
    ];
    const initialState: UserTaskList = {
      id: "user-1",
      firstName: "Jane",
      tasks: initialTasks,
    };
    const [store, update] = createStore(initialState);

    render(<TodoListComponent store={store} />);

    // Initial text should be there
    expect(screen.getByText("Original text")).not.toBeNull();

    const newText = "This text has been updated";
    // Update the text of the first task
    await act(async () => {
      update({
        $set: {
          "tasks.0.text": newText,
        },
      });
      await flushMicrotasks();
    });

    // The old text should be gone, and the new text should be present
    expect(screen.queryByText("Original text")).toBeNull();
    expect(screen.getByText(newText)).not.toBeNull();
    // The other task should be unaffected
    expect(screen.getByText("Another item")).not.toBeNull();
  });

  it("should mark a todo as completed and update the style", async () => {
    const initialTasks: Task[] = [{ id: "task-1", isCompleted: false, text: "Incomplete Task" }];
    const initialState: UserTaskList = {
      id: "user-1",
      firstName: "Jane",
      tasks: initialTasks,
    };
    const [store, update] = createStore(initialState);

    render(<TodoListComponent store={store} />);

    const taskElement = screen.getByText("Incomplete Task");
    expect(taskElement.style.textDecoration).toBe("none");

    // Mark the task as completed
    await act(async () => {
      update({
        $set: {
          "tasks.0.isCompleted": true,
        },
      });
      await flushMicrotasks();
    });

    expect(taskElement.style.textDecoration).toBe("line-through");
  });
});
