/**
 * README React Examples Tests
 *
 * Tests for React integration examples from the README:
 * - Quick Start (DOC_TEST_32)
 * - For component (DOC_TEST_39)
 */

import { createStore, computed, effect } from "@supergrain/core";
import { tracked, For } from "@supergrain/react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("README React Examples", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Quick Start", () => {
    it("#DOC_TEST_32", () => {
      interface Todo {
        id: number;
        text: string;
        completed: boolean;
      }

      const [store] = createStore<{ todos: Todo[] }>({
        todos: [
          { id: 1, text: "Learn Supergrain", completed: false },
          { id: 2, text: "Build something", completed: false },
        ],
      });

      const TodoItem = tracked(({ todo }: { todo: Todo }) => (
        <li>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => (todo.completed = !todo.completed)}
          />
          {todo.text}
        </li>
      ));

      const titleSpy = vi.spyOn(document, "title", "set");

      const App = tracked(() => {
        const remaining = computed(() => store.todos.filter((t) => !t.completed).length);

        effect(() => {
          document.title = `${remaining()} items left`;
        });

        return (
          <div>
            <h1>Todos ({remaining()})</h1>
            <For each={store.todos}>{(todo) => <TodoItem key={todo.id} todo={todo} />}</For>
          </div>
        );
      });

      render(<App />);

      expect(screen.getByText("Todos (2)")).toBeInTheDocument();
      expect(screen.getByText("Learn Supergrain")).toBeInTheDocument();
      expect(screen.getByText("Build something")).toBeInTheDocument();
      expect(titleSpy).toHaveBeenCalledWith("2 items left");

      act(() => {
        store.todos[0].completed = true;
      });

      expect(screen.getByText("Todos (1)")).toBeInTheDocument();
      expect(titleSpy).toHaveBeenCalledWith("1 items left");
    });
  });

  describe("For Component", () => {
    it("#DOC_TEST_39", () => {
      const [store] = createStore({
        todos: [
          { id: 1, text: "Task 1", completed: false },
          { id: 2, text: "Task 2", completed: true },
        ],
      });

      const TodoItem = tracked(({ todo }: { todo: any }) => (
        <div className={todo.completed ? "completed" : ""}>{todo.text}</div>
      ));

      const TodoList = tracked(() => (
        <For each={store.todos} fallback={<div>No todos yet</div>}>
          {(todo) => <TodoItem key={todo.id} todo={todo} />}
        </For>
      ));

      render(<TodoList />);

      expect(screen.getByText("Task 1")).toBeInTheDocument();
      expect(screen.getByText("Task 2")).toBeInTheDocument();

      const task2Container = screen.getByText("Task 2").closest("div");
      expect(task2Container).toHaveClass("completed");
    });
  });
});
