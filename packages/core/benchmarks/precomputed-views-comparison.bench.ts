/**
 * Proxy vs class getter vs model store: reactive read comparison.
 *
 * Class getters are V8's sweet spot — inlined to near-bare-signal speed.
 */

import { bench, describe } from "vitest";
import { createStore, unwrap } from "../src";
import { effect, signal } from "alien-signals";
import { createTodo, StoreView, TodoSchema } from "../test-support/todo-model";

// --- Reactive leaf reads ---

describe("Reactive Leaf Reads (100k inside effect)", () => {
  const [proxyStore] = createStore(createTodo());

  const viewRaw = unwrap(createStore(createTodo())[0]) as any;
  const view = new StoreView(viewRaw);

  const [, , modelView] = createStore(createTodo(), TodoSchema);

  bench("proxy", () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        proxyStore.title;
      }
    });
    dispose();
  });

  bench("class getter", () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        view.title;
      }
    });
    dispose();
  });

  bench("model store (schema-driven)", () => {
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        modelView.title;
      }
    });
    dispose();
  });

  bench("raw signal baseline", () => {
    const sig = signal("Buy milk");
    const dispose = effect(() => {
      for (let i = 0; i < 100_000; i++) {
        sig();
      }
    });
    dispose();
  });
});

// --- Reactive updates ---

describe("Reactive Updates (1000 mutations)", () => {
  bench("proxy", () => {
    const [store, update] = createStore(createTodo());
    const dispose = effect(() => {
      store.title;
    });
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } });
    }
    dispose();
  });

  bench("class getter", () => {
    const [store, update] = createStore(createTodo());
    const raw = unwrap(store) as any;
    const v = new StoreView(raw);
    const dispose = effect(() => {
      v.title;
    });
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } });
    }
    dispose();
  });

  bench("model store (schema-driven)", () => {
    const [, update, mv] = createStore(createTodo(), TodoSchema);
    const dispose = effect(() => {
      mv.title;
    });
    for (let i = 0; i < 1000; i++) {
      update({ $set: { title: `Title ${i}` } });
    }
    dispose();
  });
});

// --- Component render: 6 leaf reads ---

describe("Component Render: 6 leaf reads (10k renders)", () => {
  const [proxyStore] = createStore(createTodo());

  const viewRaw = unwrap(createStore(createTodo())[0]) as any;
  const view = new StoreView(viewRaw);

  bench("proxy", () => {
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        proxyStore.title;
        proxyStore.completed;
        proxyStore.dueDate;
        proxyStore.notes;
        proxyStore.createdAt;
        proxyStore.updatedAt;
      }
    });
    dispose();
  });

  bench("class getter", () => {
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        view.title;
        view.completed;
        view.dueDate;
        view.notes;
        view.createdAt;
        view.updatedAt;
      }
    });
    dispose();
  });

  const [, , modelView6] = createStore(createTodo(), TodoSchema);

  bench("model store (schema-driven)", () => {
    const dispose = effect(() => {
      for (let i = 0; i < 10_000; i++) {
        modelView6.title;
        modelView6.completed;
        modelView6.dueDate;
        modelView6.notes;
        modelView6.createdAt;
        modelView6.updatedAt;
      }
    });
    dispose();
  });
});

// --- Batched updates ---

describe("Batched Updates: 5 fields (1000 batches)", () => {
  bench("proxy", () => {
    const [store, update] = createStore(createTodo());
    const dispose = effect(() => {
      store.title;
      store.completed;
      store.notes;
      store.dueDate;
      store.updatedAt;
    });
    for (let i = 0; i < 1000; i++) {
      update({
        $set: {
          title: `T${i}`,
          completed: i % 2 === 0,
          notes: `N${i}`,
          dueDate: `D${i}`,
          updatedAt: `U${i}`,
        },
      });
    }
    dispose();
  });

  bench("class getter", () => {
    const [store, update] = createStore(createTodo());
    const raw = unwrap(store) as any;
    const v = new StoreView(raw);
    const dispose = effect(() => {
      v.title;
      v.completed;
      v.notes;
      v.dueDate;
      v.updatedAt;
    });
    for (let i = 0; i < 1000; i++) {
      update({
        $set: {
          title: `T${i}`,
          completed: i % 2 === 0,
          notes: `N${i}`,
          dueDate: `D${i}`,
          updatedAt: `U${i}`,
        },
      });
    }
    dispose();
  });

  bench("model store (schema-driven)", () => {
    const [, update, mv] = createStore(createTodo(), TodoSchema);
    const dispose = effect(() => {
      mv.title;
      mv.completed;
      mv.notes;
      mv.dueDate;
      mv.updatedAt;
    });
    for (let i = 0; i < 1000; i++) {
      update({
        $set: {
          title: `T${i}`,
          completed: i % 2 === 0,
          notes: `N${i}`,
          dueDate: `D${i}`,
          updatedAt: `U${i}`,
        },
      });
    }
    dispose();
  });
});
