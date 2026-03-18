import { type } from "arktype";
import { describe, it, expect, vi } from "vitest";

import { createStore, effect } from "../../src";
import { createTodo, TodoSchema } from "../../test-support/todo-model";

describe("createStore with schema", () => {
  it("should create a store with view from schema", () => {
    const [_store, _update, view] = createStore(createTodo(), TodoSchema);

    expect(view.title).toBe("Buy milk");
    expect(view.id).toBe(1);
    expect(view.completed).toBe(false);
  });

  it("should return reactive view reads inside effects", () => {
    const [_store, update, view] = createStore(createTodo(), TodoSchema);

    let title = "";
    const effectFn = vi.fn(() => {
      title = view.title;
    });

    effect(effectFn);
    expect(title).toBe("Buy milk");
    expect(effectFn).toHaveBeenCalledTimes(1);

    update({ $set: { title: "Buy eggs" } });
    expect(title).toBe("Buy eggs");
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("should allow writes through the update function", () => {
    const [_store, update, view] = createStore(createTodo(), TodoSchema);

    expect(view.completed).toBe(false);
    update({ $set: { completed: true } });
    expect(view.completed).toBe(true);
  });

  it("should handle nested object views", () => {
    const [_store, _update, view] = createStore(createTodo(), TodoSchema);

    const assigneeView = view.assignee;
    expect(assigneeView.name).toBe("Scott");
    expect(assigneeView.avatar).toBe("scott.png");
  });

  it("should reactively track nested object properties", () => {
    const [_store, update, view] = createStore(createTodo(), TodoSchema);

    let name = "";
    const effectFn = vi.fn(() => {
      name = view.assignee.name;
    });

    effect(effectFn);
    expect(name).toBe("Scott");
    expect(effectFn).toHaveBeenCalledTimes(1);

    update({ $set: { "assignee.name": "Alice" } });
    expect(name).toBe("Alice");
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("should handle sub-tree replacement for nested objects", () => {
    const [_store, update, view] = createStore(createTodo(), TodoSchema);

    let name = "";
    const effectFn = vi.fn(() => {
      name = view.assignee.name;
    });

    effect(effectFn);
    expect(name).toBe("Scott");

    update({ $set: { assignee: { name: "Bob", avatar: "bob.png" } } });
    expect(name).toBe("Bob");
    expect(view.assignee.avatar).toBe("bob.png");
  });

  it("should only re-run effects when tracked properties change", () => {
    const [_store, update, view] = createStore(createTodo(), TodoSchema);

    let title = "";
    const titleEffect = vi.fn(() => {
      title = view.title;
    });

    effect(titleEffect);
    expect(titleEffect).toHaveBeenCalledTimes(1);

    update({ $set: { completed: true } });
    expect(titleEffect).toHaveBeenCalledTimes(1);

    update({ $set: { title: "Buy eggs" } });
    expect(titleEffect).toHaveBeenCalledTimes(2);
    expect(title).toBe("Buy eggs");
  });

  it("should share view prototype across instances with the same schema", () => {
    const data1 = createTodo({
      title: "A",
      assignee: { name: "X", avatar: "x.png" },
    });
    const data2 = createTodo({
      id: 2,
      title: "B",
      completed: true,
      assignee: { name: "Y", avatar: "y.png" },
    });

    const [, , view1] = createStore(data1, TodoSchema);
    const [, , view2] = createStore(data2, TodoSchema);

    expect(Object.getPrototypeOf(view1)).toBe(Object.getPrototypeOf(view2));
  });

  it("should work with a flat schema (no nested objects)", () => {
    const FlatSchema = type({
      x: "number",
      y: "number",
      label: "string",
    });

    const [_store, update, view] = createStore(
      {
        x: 10,
        y: 20,
        label: "origin",
      },
      FlatSchema,
    );

    let label = "";
    const effectFn = vi.fn(() => {
      label = view.label;
    });

    effect(effectFn);
    expect(label).toBe("origin");

    update({ $set: { label: "moved" } });
    expect(label).toBe("moved");
    expect(effectFn).toHaveBeenCalledTimes(2);
  });

  it("should enumerate and spread typed views like normal objects", () => {
    const [_store, _update, view] = createStore(createTodo(), TodoSchema);

    expect(Object.keys(view).sort()).toEqual([
      "assignee",
      "completed",
      "createdAt",
      "dueDate",
      "id",
      "notes",
      "title",
      "updatedAt",
    ]);
    expect({ ...view }).toEqual({
      assignee: view.assignee,
      completed: false,
      createdAt: "2026-03-01",
      dueDate: "2026-03-15",
      id: 1,
      notes: "Get 2% milk",
      title: "Buy milk",
      updatedAt: "2026-03-13",
    });
    expect(Object.keys(view.assignee).sort()).toEqual(["avatar", "name"]);
  });

  it("should reject reusing the same raw object with a different schema", () => {
    const shared = createTodo();

    createStore(shared, TodoSchema);

    const AlternateSchema = type({
      id: "number",
      title: "string",
    });

    expect(() => createStore(shared, AlternateSchema)).toThrow(/multiple typed store schemas/i);
  });

  it("should reject direct mutation attempts on typed views", () => {
    const [_store, _update, view] = createStore(createTodo(), TodoSchema);

    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.assignee)).toBe(true);
    expect(() => {
      (view as any).title = "Buy eggs";
    }).toThrow();
    expect(() => {
      (view.assignee as any).name = "Alice";
    }).toThrow();
  });
});
