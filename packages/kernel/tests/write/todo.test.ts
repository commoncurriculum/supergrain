import { update } from "@supergrain/mill";
import { describe, it, expect, vi } from "vitest";

import { createReactive, effect } from "../../src";

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

interface AppState {
  userTaskList: UserTaskList;
}

describe("Todo App Core Tests", () => {
  it("should add a todo to the tasks array using $push", () => {
    const initialState: AppState = {
      userTaskList: {
        id: "user-1",
        firstName: "John",
        tasks: [],
      },
    };

    const state = createReactive(initialState);

    // The list-rendering component subscribes to length + each task.
    let lengthSeen = -1;
    let textsSeen: Array<string> = [];
    const listEffect = vi.fn(() => {
      lengthSeen = state.userTaskList.tasks.length;
      textsSeen = state.userTaskList.tasks.map((t) => t.text);
    });
    effect(listEffect);

    expect(lengthSeen).toBe(0);
    expect(textsSeen).toEqual([]);
    expect(listEffect).toHaveBeenCalledTimes(1);

    const newTask: Task = {
      id: "task-1",
      isCompleted: false,
      text: "Write tests based on USAGE.md",
    };
    update(state, { $push: { "userTaskList.tasks": newTask } });

    expect(state.userTaskList.tasks.length).toBe(1);
    expect(state.userTaskList.tasks[0]).toEqual(newTask);
    // The list re-rendered after the push.
    expect(lengthSeen).toBe(1);
    expect(textsSeen).toEqual(["Write tests based on USAGE.md"]);
    expect(listEffect).toHaveBeenCalledTimes(2);
  });

  it("should remove a todo from the tasks array using $pull", () => {
    const initialTasks: Task[] = [
      { id: "task-1", isCompleted: false, text: "Write tests" },
      { id: "task-2", isCompleted: true, text: "Implement feature" },
    ];
    const initialState: AppState = {
      userTaskList: {
        id: "user-1",
        firstName: "John",
        tasks: initialTasks,
      },
    };

    const state = createReactive(initialState);

    let idsSeen: Array<string> = [];
    const listEffect = vi.fn(() => {
      idsSeen = state.userTaskList.tasks.map((t) => t.id);
    });
    effect(listEffect);

    expect(idsSeen).toEqual(["task-1", "task-2"]);
    expect(listEffect).toHaveBeenCalledTimes(1);

    update(state, { $pull: { "userTaskList.tasks": { id: "task-1" } } });

    expect(state.userTaskList.tasks.length).toBe(1);
    expect(state.userTaskList.tasks[0]!.id).toBe("task-2");
    // The list re-rendered with the surviving task.
    expect(idsSeen).toEqual(["task-2"]);
    expect(listEffect).toHaveBeenCalledTimes(2);
  });

  it("should update the text of a todo using $set without re-rendering siblings", () => {
    const initialTasks: Task[] = [
      { id: "task-1", isCompleted: false, text: "Initial text" },
      { id: "task-2", isCompleted: true, text: "Another task" },
    ];
    const initialState: AppState = {
      userTaskList: {
        id: "user-1",
        firstName: "John",
        tasks: initialTasks,
      },
    };

    const state = createReactive(initialState);
    const newText = "Updated task text";

    // Per-row effects mirror how a list of `<TodoItem>` components subscribes
    // — each row only tracks its own task's text.
    let row0Text = "";
    let row1Text = "";
    const row0Effect = vi.fn(() => {
      row0Text = state.userTaskList.tasks[0]!.text;
    });
    const row1Effect = vi.fn(() => {
      row1Text = state.userTaskList.tasks[1]!.text;
    });
    effect(row0Effect);
    effect(row1Effect);

    expect(row0Text).toBe("Initial text");
    expect(row1Text).toBe("Another task");

    update(state, { $set: { "userTaskList.tasks.0.text": newText } });

    expect(state.userTaskList.tasks[0]!.text).toBe(newText);
    expect(state.userTaskList.tasks[1]!.text).toBe("Another task");
    // The mutated row re-rendered, the untouched row did NOT.
    expect(row0Text).toBe(newText);
    expect(row0Effect).toHaveBeenCalledTimes(2);
    expect(row1Effect).toHaveBeenCalledTimes(1);
  });

  it("should mark a todo as completed using $set", () => {
    const initialTasks: Task[] = [{ id: "task-1", isCompleted: false, text: "Do something" }];
    const initialState: AppState = {
      userTaskList: {
        id: "user-1",
        firstName: "John",
        tasks: initialTasks,
      },
    };

    const state = createReactive(initialState);

    let textSeen = "";
    let completedSeen = false;
    const textEffect = vi.fn(() => {
      textSeen = state.userTaskList.tasks[0]!.text;
    });
    const completedEffect = vi.fn(() => {
      completedSeen = state.userTaskList.tasks[0]!.isCompleted;
    });
    effect(textEffect);
    effect(completedEffect);

    expect(state.userTaskList.tasks[0]!.isCompleted).toBe(false);
    expect(textSeen).toBe("Do something");
    expect(completedSeen).toBe(false);

    update(state, { $set: { "userTaskList.tasks.0.isCompleted": true } });

    expect(state.userTaskList.tasks[0]!.isCompleted).toBe(true);
    // The completion-tracking effect re-fires; the text effect is unaffected
    // — that's the fine-grained reactivity contract a checkbox toggle needs.
    expect(completedSeen).toBe(true);
    expect(completedEffect).toHaveBeenCalledTimes(2);
    expect(textEffect).toHaveBeenCalledTimes(1);
  });
});
