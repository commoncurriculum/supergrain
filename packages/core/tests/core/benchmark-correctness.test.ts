import { effect } from "alien-signals";
import { describe, expect, it } from "vitest";

import { createStore, unwrap } from "../../src";
import { createTodo, StoreView, TodoSchema, type Todo } from "../../test-support/todo-model";

function readSnapshot(subject: {
  title: string;
  completed: boolean;
  dueDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}): Pick<Todo, "title" | "completed" | "dueDate" | "notes" | "createdAt" | "updatedAt"> {
  return {
    title: subject.title,
    completed: subject.completed,
    dueDate: subject.dueDate,
    notes: subject.notes,
    createdAt: subject.createdAt,
    updatedAt: subject.updatedAt,
  };
}

describe("benchmark correctness", () => {
  it("proxy, class getter, and typed view agree on leaf reads", () => {
    const [proxyStore] = createStore(createTodo());
    const classView = new StoreView(unwrap(createStore(createTodo())[0]));
    const [, , typedView] = createStore(createTodo(), TodoSchema);

    const expected = readSnapshot(proxyStore);
    expect(readSnapshot(classView)).toEqual(expected);
    expect(readSnapshot(typedView)).toEqual(expected);
  });

  it("benchmark read models observe the same reactive updates", () => {
    const [proxyStore, update] = createStore(createTodo());
    const classView = new StoreView(unwrap(proxyStore));
    const [, typedUpdate, typedView] = createStore(createTodo(), TodoSchema);

    let proxyTitle = "";
    let classTitle = "";
    let typedTitle = "";

    const disposeProxy = effect(() => {
      proxyTitle = proxyStore.title;
    });
    const disposeClass = effect(() => {
      classTitle = classView.title;
    });
    const disposeTyped = effect(() => {
      typedTitle = typedView.title;
    });

    update({ $set: { title: "Buy eggs" } });
    typedUpdate({ $set: { title: "Buy eggs" } });

    expect(proxyTitle).toBe("Buy eggs");
    expect(classTitle).toBe("Buy eggs");
    expect(typedTitle).toBe("Buy eggs");

    disposeProxy();
    disposeClass();
    disposeTyped();
  });

  it("batched benchmark update patterns converge to the same final snapshot", () => {
    const [proxyStore, update] = createStore(createTodo());
    const [classStore, classUpdate] = createStore(createTodo());
    const classView = new StoreView(unwrap(classStore));
    const [, typedUpdate, typedView] = createStore(createTodo(), TodoSchema);

    for (let i = 0; i < 50; i++) {
      const patch = {
        title: `T${i}`,
        completed: i % 2 === 0,
        notes: `N${i}`,
        dueDate: `D${i}`,
        updatedAt: `U${i}`,
      } as const;

      update({ $set: patch });
      classUpdate({ $set: patch });
      typedUpdate({ $set: patch });
    }

    expect(readSnapshot(proxyStore)).toEqual(readSnapshot(classView));
    expect(readSnapshot(proxyStore)).toEqual(readSnapshot(typedView));
  });
});
