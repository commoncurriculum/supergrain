import { type } from "arktype";
import { signal } from "alien-signals";
import { $NODE } from "../src/internal";

export const TodoSchema = type({
  id: "number",
  title: "string",
  completed: "boolean",
  assignee: {
    name: "string",
    avatar: "string",
  },
  dueDate: "string",
  notes: "string",
  createdAt: "string",
  updatedAt: "string",
});

export type Todo = typeof TodoSchema.infer;

export function createTodo(overrides: Partial<Todo> = {}): Todo {
  const assignee = {
    name: "Scott",
    avatar: "scott.png",
    ...overrides.assignee,
  };

  const base: Todo = {
    id: 1,
    title: "Buy milk",
    completed: false,
    assignee: { name: "Scott", avatar: "scott.png" },
    dueDate: "2026-03-15",
    notes: "Get 2% milk",
    createdAt: "2026-03-01",
    updatedAt: "2026-03-13",
  };

  const todo: Todo = {
    ...base,
    ...overrides,
  };
  todo.assignee = assignee;
  return todo;
}

// Class getter view used as a benchmark/reference implementation.
export class StoreView {
  _n: any;

  constructor(raw: any) {
    const nodes =
      raw[$NODE] ||
      (Object.defineProperty(raw, $NODE, {
        value: {},
        enumerable: false,
        configurable: true,
      }),
      raw[$NODE]);

    for (const key of ["title", "completed", "dueDate", "notes", "createdAt", "updatedAt"]) {
      if (!nodes[key]) nodes[key] = signal(raw[key]);
    }

    this._n = nodes;
  }

  get title() {
    return this._n.title();
  }
  get completed() {
    return this._n.completed();
  }
  get dueDate() {
    return this._n.dueDate();
  }
  get notes() {
    return this._n.notes();
  }
  get createdAt() {
    return this._n.createdAt();
  }
  get updatedAt() {
    return this._n.updatedAt();
  }
}
