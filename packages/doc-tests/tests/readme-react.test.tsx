/**
 * README React Examples Tests
 *
 * Tests for React integration examples from the README:
 * - Quick Start (DOC_TEST_QUICK_START)
 */

import { createStore } from "@supergrain/core";
import { tracked, provideStore, useComputed, useSignalEffect, For } from "@supergrain/react";
import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("README React Examples", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("#DOC_TEST_QUICK_START", () => {
    interface Todo {
      id: number;
      text: string;
      completed: boolean;
    }
    interface AppState {
      todos: Todo[];
      selected: number | null;
    }

    const [store] = createStore<AppState>({
      todos: [
        { id: 1, text: "Learn Supergrain", completed: false },
        { id: 2, text: "Build something", completed: false },
      ],
      selected: null,
    });

    const Store = provideStore(store);

    const TodoItem = tracked(({ todo }: { todo: Todo }) => {
      const s = Store.useStore();
      const isSelected = useComputed(() => s.selected === todo.id);

      return (
        <li className={isSelected ? "selected" : ""}>
          <input
            type="checkbox"
            checked={todo.completed}
            onChange={() => (todo.completed = !todo.completed)}
          />
          {todo.text}
        </li>
      );
    });

    const titleSpy = vi.spyOn(document, "title", "set");

    const App = tracked(() => {
      const s = Store.useStore();
      const remaining = useComputed(() => s.todos.filter((t) => !t.completed).length);

      useSignalEffect(() => {
        document.title = `${remaining} items left`;
      });

      return (
        <div>
          <h1>Todos ({remaining})</h1>
          <For each={s.todos}>{(todo) => <TodoItem key={todo.id} todo={todo} />}</For>
        </div>
      );
    });

    render(
      <Store.Provider>
        <App />
      </Store.Provider>,
    );

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
