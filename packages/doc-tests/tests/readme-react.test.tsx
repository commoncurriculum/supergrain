/**
 * README React Examples Tests
 *
 * Tests for React integration examples from the README:
 * - Quick Start (DOC_TEST_32)
 * - Fine-grained reactivity (DOC_TEST_35)
 */

import { createStore, computed, effect } from "@supergrain/core";
import { tracked } from "@supergrain/react";
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

      // Computed
      const remaining = computed(() => store.todos.filter((t) => !t.completed).length);
      expect(remaining()).toBe(2);

      // Effect
      const titleSpy = vi.spyOn(document, "title", "set");
      effect(() => {
        document.title = `${remaining()} items left`;
      });
      expect(titleSpy).toHaveBeenCalledWith("2 items left");

      // tracked components
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

      const App = tracked(() => (
        <div>
          <h1>Todos ({remaining()})</h1>
          <ul>
            {store.todos.map((todo) => (
              <TodoItem key={todo.id} todo={todo} />
            ))}
          </ul>
        </div>
      ));

      render(<App />);

      expect(screen.getByText("Todos (2)")).toBeInTheDocument();
      expect(screen.getByText("Learn Supergrain")).toBeInTheDocument();
      expect(screen.getByText("Build something")).toBeInTheDocument();

      // Mutate directly — completing a todo updates computed and re-renders
      act(() => {
        store.todos[0].completed = true;
      });

      expect(remaining()).toBe(1);
      expect(screen.getByText("Todos (1)")).toBeInTheDocument();
    });
  });

  describe("Fine-Grained Reactivity", () => {
    it("#DOC_TEST_35", () => {
      const [store] = createStore({
        user: { profile: { name: "Alice", age: 30 } },
        items: [{ title: "Item 1" }, { title: "Item 2" }],
      });

      const Profile = tracked(() => <h1>{store.user.profile.name}</h1>);

      render(<Profile />);

      expect(screen.getByText("Alice")).toBeInTheDocument();

      act(() => {
        store.user.profile.age = 31;
      });
      expect(screen.getByText("Alice")).toBeInTheDocument();

      act(() => {
        store.user.profile.name = "Bob";
      });
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });
});
