import { describe, it, expect } from "vitest";
import { createStore } from "../../src";

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

    const [state, update] = createStore(initialState);

    const newTask: Task = {
      id: "task-1",
      isCompleted: false,
      text: "Write tests based on USAGE.md",
    };

    update({
      $push: {
        "userTaskList.tasks": newTask,
      },
    });

    expect(state.userTaskList.tasks.length).toBe(1);
    expect(state.userTaskList.tasks[0]).toEqual(newTask);
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

    const [state, update] = createStore(initialState);

    update({
      $pull: {
        "userTaskList.tasks": { id: "task-1" },
      },
    });

    expect(state.userTaskList.tasks.length).toBe(1);
    expect(state.userTaskList.tasks[0]!.id).toBe("task-2");
  });

  it("should update the text of a todo using $set", () => {
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

    const [state, update] = createStore(initialState);
    const newText = "Updated task text";

    update({
      $set: {
        "userTaskList.tasks.0.text": newText,
      },
    });

    expect(state.userTaskList.tasks[0]!.text).toBe(newText);
    expect(state.userTaskList.tasks[1]!.text).toBe("Another task");
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

    const [state, update] = createStore(initialState);

    expect(state.userTaskList.tasks[0]!.isCompleted).toBe(false);

    update({
      $set: {
        "userTaskList.tasks.0.isCompleted": true,
      },
    });

    expect(state.userTaskList.tasks[0]!.isCompleted).toBe(true);
  });
});
