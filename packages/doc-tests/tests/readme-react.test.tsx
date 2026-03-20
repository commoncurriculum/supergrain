/**
 * README React Examples Tests
 *
 * Tests for React integration examples from the README:
 * - Quick Start (DOC_TEST_32)
 * - Fine-grained reactivity (DOC_TEST_34, DOC_TEST_35)
 * - tracked() replaces memo() (DOC_TEST_36)
 * - For component (DOC_TEST_39)
 * - TypeScript component (DOC_TEST_41)
 */

import { createStore } from "@supergrain/core";
import { tracked, For } from "@supergrain/react";
import { render, screen, act } from "@testing-library/react";
import { memo } from "react";
import { describe, it, expect } from "vitest";
import { userEvent } from "vitest/browser";

describe("README React Examples", () => {
  describe("Quick Start", () => {
    it("#DOC_TEST_32", async () => {
      const [store] = createStore({
        count: 0,
        user: { name: "John" },
      });

      const App = tracked(() => (
        <div>
          <h1>
            {store.user.name}: {store.count}
          </h1>
          <button onClick={() => store.count++}>Increment</button>
        </div>
      ));

      render(<App />);

      expect(screen.getByText("John: 0")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Increment"));
      expect(screen.getByText("John: 1")).toBeInTheDocument();
    });
  });

  describe("Fine-Grained Reactivity", () => {
    it("#DOC_TEST_34", () => {
      const [store] = createStore({ x: 1, y: 2, z: 3 });

      const ShowX = tracked(() => <div>X: {store.x}</div>);
      const ShowY = tracked(() => <div>Y: {store.y}</div>);

      render(
        <div>
          <ShowX />
          <ShowY />
        </div>,
      );

      expect(screen.getByText("X: 1")).toBeInTheDocument();
      expect(screen.getByText("Y: 2")).toBeInTheDocument();

      // Updating z doesn't affect components reading x or y
      act(() => {
        store.z = 10;
      });

      expect(screen.getByText("X: 1")).toBeInTheDocument();
      expect(screen.getByText("Y: 2")).toBeInTheDocument();
    });

    it("#DOC_TEST_35", () => {
      const [store] = createStore({
        user: { profile: { name: "Alice", age: 30 } },
        items: [{ title: "Item 1" }, { title: "Item 2" }],
      });

      const Profile = tracked(() => <h1>{store.user.profile.name}</h1>);

      render(<Profile />);

      expect(screen.getByText("Alice")).toBeInTheDocument();

      // Changing age does NOT re-render Profile (it only reads name)
      act(() => {
        store.user.profile.age = 31;
      });
      expect(screen.getByText("Alice")).toBeInTheDocument();

      // Changing name DOES re-render Profile
      act(() => {
        store.user.profile.name = "Bob";
      });
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });

  describe("tracked() Replaces memo()", () => {
    it("#DOC_TEST_36", () => {
      const [store] = createStore({
        tasks: [
          { id: 1, title: "Task 1", completed: false },
          { id: 2, title: "Task 2", completed: true },
        ],
      });

      const TaskRow = tracked(({ taskId }: { taskId: number }) => {
        const task = store.tasks.find((t) => t.id === taskId)!;
        return (
          <div>
            <h3>{task.title}</h3>
            <span>{task.completed ? "Done" : "Pending"}</span>
          </div>
        );
      });

      const TaskList = tracked(() => (
        <div>
          {store.tasks.map((task) => (
            <TaskRow key={task.id} taskId={task.id} />
          ))}
        </div>
      ));

      render(<TaskList />);

      expect(screen.getByText("Task 1")).toBeInTheDocument();
      expect(screen.getByText("Task 2")).toBeInTheDocument();
      expect(screen.getByText("Pending")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
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

      const TodoItem = memo(({ todo }: { todo: any }) => (
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

  describe("TypeScript Component", () => {
    it("#DOC_TEST_41", () => {
      interface AppState {
        user: {
          name: string;
          age: number;
          preferences: {
            theme: "light" | "dark";
            notifications: boolean;
          };
        };
        items: { id: string; title: string; count: number }[];
      }

      const [store] = createStore<AppState>({
        user: {
          name: "John",
          age: 30,
          preferences: { theme: "light", notifications: true },
        },
        items: [],
      });

      const UserProfile = tracked(() => (
        <div>
          <h1>{store.user.name}</h1>
          <p>Age: {store.user.age}</p>
        </div>
      ));

      render(<UserProfile />);

      expect(screen.getByText("John")).toBeInTheDocument();
      expect(screen.getByText("Age: 30")).toBeInTheDocument();
    });
  });
});
