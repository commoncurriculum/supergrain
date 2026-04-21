/**
 * README React Examples Tests
 *
 * Tests for React integration examples from the README:
 * - Local state (DOC_TEST_LOCAL_STATE)
 * - Quick Start (DOC_TEST_QUICK_START)
 */

import {
  tracked,
  StoreProvider,
  useStore,
  useReactive,
  useComputed,
  useSignalEffect,
  For,
} from "@supergrain/react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

describe("README React Examples", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("#DOC_TEST_LOCAL_STATE", () => {
    const Counter = tracked(() => {
      const state = useReactive({ count: 0 });
      return <button onClick={() => state.count++}>Clicked {state.count} times</button>;
    });

    const { getByRole } = render(<Counter />);
    const button = getByRole("button");
    expect(button.textContent).toBe("Clicked 0 times");

    act(() => {
      fireEvent.click(button);
    });
    expect(button.textContent).toBe("Clicked 1 times");

    act(() => {
      fireEvent.click(button);
    });
    expect(button.textContent).toBe("Clicked 2 times");
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

    function initState(): AppState {
      return {
        todos: [
          { id: 1, text: "Learn Supergrain", completed: false },
          { id: 2, text: "Build something", completed: false },
        ],
        selected: null,
      };
    }

    const TodoItem = tracked(({ todo }: { todo: Todo }) => {
      const s = useStore<AppState>();
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
      const s = useStore<AppState>();
      const remaining = useComputed(() => s.todos.filter((t) => !t.completed).length);

      useSignalEffect(() => {
        const count = s.todos.filter((t) => !t.completed).length;
        document.title = `${count} items left`;
      });

      return (
        <div>
          <h1>Todos ({remaining})</h1>
          <For each={s.todos}>{(todo) => <TodoItem key={todo.id} todo={todo} />}</For>
        </div>
      );
    });

    // Probe the store from inside the Provider so the test can mutate it.
    let storeRef: AppState = null!;
    const Probe = () => {
      storeRef = useStore<AppState>();
      return null;
    };

    render(
      <StoreProvider<AppState> init={initState}>
        <Probe />
        <App />
      </StoreProvider>,
    );

    expect(screen.getByText("Todos (2)")).toBeInTheDocument();
    expect(screen.getByText("Learn Supergrain")).toBeInTheDocument();
    expect(screen.getByText("Build something")).toBeInTheDocument();
    expect(titleSpy).toHaveBeenCalledWith("2 items left");

    act(() => {
      storeRef.todos[0].completed = true;
    });

    expect(screen.getByText("Todos (1)")).toBeInTheDocument();
    expect(titleSpy).toHaveBeenCalledWith("1 items left");
  });
});
