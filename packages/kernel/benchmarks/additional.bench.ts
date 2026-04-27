import { update } from "@supergrain/mill";
import { effect } from "alien-signals";
// Proxy overhead analysis, effect lifecycle, and complex reactive scenarios.
import { bench, describe } from "vitest";

import { createGrain } from "../src";

describe("Additional: Plain vs Proxy Performance", () => {
  describe("Property Access", () => {
    const plainObject = { name: "John Doe", age: 30 };
    const proxyObject = createGrain({ name: "John Doe", age: 30 });

    bench("plain object: 100k property reads", () => {
      let value;
      for (let i = 0; i < 100000; i++) {
        value = plainObject.name;
      }
      void value;
    });

    bench("proxy object: 100k property reads", () => {
      let value;
      for (let i = 0; i < 100000; i++) {
        value = proxyObject.name;
      }
      void value;
    });
  });

  describe("Property Set", () => {
    bench("plain object: 100k property sets", () => {
      const plainObject = { value: 0 };
      for (let i = 0; i < 100000; i++) {
        plainObject.value = i;
      }
    });

    bench("proxy object: 100k property sets", () => {
      const _proxyObject = createGrain({ value: 0 });
      for (let i = 0; i < 100000; i++) {
        update(_proxyObject, { $set: { value: i } });
      }
    });
  });

  describe("Deep Property Access", () => {
    const plainDeep = { level1: { level2: { level3: { value: "test" } } } };
    const proxyDeep = createGrain({
      level1: { level2: { level3: { value: "test" } } },
    });

    bench("plain object: deep property read", () => {
      let value;
      for (let i = 0; i < 100000; i++) {
        value = plainDeep.level1.level2.level3.value;
      }
      void value;
    });

    bench("proxy object: deep property read", () => {
      let value;
      for (let i = 0; i < 100000; i++) {
        value = proxyDeep.level1.level2.level3.value;
      }
      void value;
    });
  });
});

describe("Additional: Effect Creation and Destruction", () => {
  bench("create/dispose 1000 effects for one signal", () => {
    const store = createGrain({ value: 0 });
    let totalTracked = 0;
    const disposers = [];

    for (let i = 0; i < 1000; i++) {
      disposers.push(
        effect(() => {
          store.value;
          totalTracked++;
        }),
      );
    }

    for (const dispose of disposers) {
      dispose();
    }
  });

  bench("create/dispose one effect 10000 times", () => {
    const store = createGrain({ counter: 0 });
    let totalTracked = 0;

    for (let i = 0; i < 10000; i++) {
      const dispose = effect(() => {
        store.counter;
        totalTracked++;
      });
      dispose();
    }
  });
});

describe("Additional: Signal Subscription/Unsubscription", () => {
  bench("subscribe/unsubscribe 10k listeners to one signal", () => {
    const store = createGrain({ value: 0 });
    const disposers = [];
    for (let i = 0; i < 10000; i++) {
      disposers.push(effect(() => store.value));
    }
    for (const d of disposers) {
      d();
    }
  });
});

describe("Additional: Batched vs Unbatched Updates", () => {
  bench("10 unbatched updates triggering one effect", () => {
    const store = createGrain({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      g: 0,
      h: 0,
      i: 0,
      j: 10,
    });
    let total = 0;
    let effectRan = false;
    const dispose = effect(() => {
      effectRan = true;
      total =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j;
    });

    update(store, { $set: { a: 1 } });
    update(store, { $set: { b: 2 } });
    update(store, { $set: { c: 3 } });
    update(store, { $set: { d: 4 } });
    update(store, { $set: { e: 5 } });
    update(store, { $set: { f: 6 } });
    update(store, { $set: { g: 7 } });
    update(store, { $set: { h: 8 } });
    update(store, { $set: { i: 9 } });
    update(store, { $set: { j: 10 } });

    void total;
    void effectRan;
    dispose();
  });

  bench("10 batched updates triggering one effect", () => {
    const store = createGrain({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      e: 0,
      f: 0,
      g: 0,
      h: 0,
      i: 0,
      j: 10,
    });
    let total = 0;
    let effectRan = false;
    const initDispose = effect(() => {
      effectRan = true;
      total =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j;
    });
    initDispose();

    // Now measure subsequent access
    let secondRan = false;
    const dispose = effect(() => {
      secondRan = true;
      total =
        store.a +
        store.b +
        store.c +
        store.d +
        store.e +
        store.f +
        store.g +
        store.h +
        store.i +
        store.j;
    });

    update(store, {
      $set: {
        a: 1,
        b: 2,
        c: 3,
        d: 4,
        e: 5,
        f: 6,
        g: 7,
        h: 8,
        i: 9,
        j: 10,
      },
    });

    void total;
    void effectRan;
    void secondRan;
    dispose();
  });
});

describe("Additional: Array Operations (Non-Reactive)", () => {
  bench("Array.push: 1000 items", () => {
    const _store = createGrain({ items: [] as number[] });
    for (let i = 0; i < 1000; i++) {
      update(_store, { $push: { items: i } });
    }
  });

  bench("Array.pop: 1000 items", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    for (let i = 0; i < 1000; i++) {
      const items = [...store.items];
      items.pop();
      update(store, { $set: { items } });
    }
  });

  bench("Array.shift: 1000 items", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    for (let i = 0; i < 1000; i++) {
      const items = [...store.items];
      items.shift();
      update(store, { $set: { items } });
    }
  });

  bench("Array.unshift: 1000 items", () => {
    const store = createGrain({ items: [] as number[] });
    for (let i = 0; i < 1000; i++) {
      const items = [i, ...store.items];
      update(store, { $set: { items } });
    }
  });

  bench("Array.splice: remove 500 from 1000", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    const items = [...store.items];
    items.splice(250, 500);
    update(store, { $set: { items } });
  });

  bench("Array.splice: add 500 to 1000", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    const newItems = Array.from({ length: 500 }, (_, i) => i + 1000);
    const items = [...store.items];
    items.splice(500, 0, ...newItems);
    update(store, { $set: { items } });
  });

  bench("Array.sort: 1000 items", () => {
    const initial = Array.from({ length: 1000 }, () => Math.random());
    const store = createGrain({ items: initial });
    const items = [...store.items].sort((a, b) => a - b);
    update(store, { $set: { items } });
  });
});

describe("Additional: Array Iteration Methods (Reactive)", () => {
  bench("Array.map: 1000 items, 10 times", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    effect(() => {
      // Benchmark the reactive read of the array
      for (let i = 0; i < 10; i++) {
        store.items.map((x) => x * 2);
      }
    });
  });

  bench("Array.filter: 1000 items, 10 times", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    effect(() => {
      for (let i = 0; i < 10; i++) {
        store.items.filter((x) => x % 2 === 0);
      }
    });
  });

  bench("Array.reduce: 1000 items, 10 times", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    effect(() => {
      for (let i = 0; i < 10; i++) {
        store.items.reduce((acc, x) => acc + x, 0);
      }
    });
  });

  bench("Array.find/findIndex: 1000 items, 100 times", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    effect(() => {
      for (let i = 0; i < 100; i++) {
        store.items.find((x) => x === 50);
        store.items.findIndex((x) => x === 50);
      }
    });
  });

  bench("Array.some/every: 1000 items, 100 times", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    effect(() => {
      for (let i = 0; i < 100; i++) {
        store.items.some((x) => x % 2 === 0);
        store.items.every((x) => x >= 0);
      }
    });
  });

  bench("Array.includes/indexOf: 1000 items, 100 times", () => {
    const initial = Array.from({ length: 1000 }, (_, i) => i);
    const store = createGrain({ items: initial });
    effect(() => {
      for (let i = 0; i < 100; i++) {
        store.items.includes(50);
        store.items.indexOf(50);
      }
    });
  });
});

describe("Additional: Complex Scenarios", () => {
  interface Row {
    id: number;
    name: string;
    value: number;
    category: string;
    selected: boolean;
    visible: boolean;
  }

  interface GridState {
    rows: Row[];
    sortColumn: keyof Row | null;
    sortDirection: "asc" | "desc";
  }

  bench("Data Grid Simulation: 100 rows", () => {
    const grid = createGrain<GridState>({
      rows: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `Row ${i}`,
        value: Math.random() * 1000,
        category: "Category " + (i % 10),
        selected: false,
        visible: true,
      })),
      sortColumn: null,
      sortDirection: "asc",
    });

    let visibleRowCount = 0;
    effect(() => {
      visibleRowCount = grid.rows.filter((r) => r.visible).length;
    });

    // Sort by value
    update(grid, {
      $set: {
        rows: [...grid.rows].sort((a, b) => (a.value > b.value ? 1 : -1)),
      },
    });

    // Filter by category
    const categoryToFilter = "Category 5";
    const updatedRows = grid.rows.map((row, _i) => ({
      ...row,
      visible: row.category === categoryToFilter,
    }));
    update(grid, { $set: { rows: updatedRows } });

    // Bulk update values
    const rowsWithUpdatedValues = grid.rows.map((row, i) =>
      i < 50 ? { ...row, value: row.value * 1.1 } : row,
    );
    update(grid, { $set: { rows: rowsWithUpdatedValues } });

    // Toggle selection
    const rowsWithToggledSelection = grid.rows.map((row, i) =>
      i % 5 === 0 ? { ...row, selected: !row.selected } : row,
    );
    update(grid, { $set: { rows: rowsWithToggledSelection } });
    void visibleRowCount;
  });

  interface CartItem {
    id: number;
    name: string;
    price: number;
    quantity: number;
    discount: number;
    subtotal: number;
  }

  interface CartState {
    items: CartItem[];
    globalDiscount: number;
    taxRate: number;
    total: number;
  }

  bench("Shopping Cart Simulation: 50 items", () => {
    const cart = createGrain<CartState>({
      items: Array.from({ length: 50 }, (_, i) => ({
        id: i,
        name: `Product ${i}`,
        price: Math.random() * 100,
        quantity: 1,
        discount: 0,
        subtotal: 0,
      })),
      globalDiscount: 0,
      taxRate: 0.08,
      total: 0,
    });

    effect(() => {
      const subtotal = cart.items.reduce((acc, item) => acc + item.subtotal, 0);
      const discounted = subtotal * (1 - cart.globalDiscount);
      update(cart, { $set: { total: discounted * (1 + cart.taxRate) } });
    });

    // Update quantities and calculate subtotals
    const itemsWithQuantity = cart.items.map((item) => ({
      ...item,
      quantity: 2,
      subtotal: item.price * 2,
    }));
    update(cart, { $set: { items: itemsWithQuantity } });

    // Apply item-level discounts
    const itemsWithDiscounts = cart.items.map((item, i) =>
      i < 25
        ? {
            ...item,
            discount: 0.1,
            subtotal: item.price * item.quantity * 0.9,
          }
        : item,
    );
    update(cart, { $set: { items: itemsWithDiscounts } });

    // Apply global discount
    update(cart, { $set: { globalDiscount: 0.05 } }); // 5% off everything

    // Remove some items
    update(cart, { $set: { items: cart.items.slice(0, 40) } });
  });

  interface TreeNode {
    id: string;
    name: string;
    selected: boolean;
    children: TreeNode[];
  }

  bench("Tree Structure Simulation: 5 levels deep", () => {
    const createNode = (id: string, level: number, maxLevel: number): TreeNode => ({
      id,
      name: `Node ${id}`,
      selected: false,
      children:
        level >= maxLevel
          ? []
          : Array.from({ length: 3 }, (_, i) => createNode(`${id}-${i}`, level + 1, maxLevel)),
    });

    const tree = createGrain({ root: createNode("root", 1, 5) });

    // Count selected nodes reactively
    function countSelected(node: TreeNode): number {
      return (
        (node.selected ? 1 : 0) +
        node.children.reduce((acc, child) => acc + countSelected(child), 0)
      );
    }

    effect(() => {
      countSelected(tree.root);
    });

    // Toggle a deep node
    const rootCopy = JSON.parse(JSON.stringify(tree.root));
    const deepNode = rootCopy.children[0]?.children[1]?.children[2];
    if (deepNode) {
      deepNode.selected = true;
    }
    update(tree, { $set: { root: rootCopy } });

    // Collapse leaf nodes
    function collapseLeaves(node: TreeNode) {
      if (node.children.length === 0) {
        return;
      }
      if (node.children.every((c) => c.children.length === 0)) {
        node.children = [];
      } else {
        node.children.forEach(collapseLeaves);
      }
    }
    const rootCopy2 = JSON.parse(JSON.stringify(tree.root));
    collapseLeaves(rootCopy2);
    update(tree, { $set: { root: rootCopy2 } });
  });
});

describe("Additional: Mixed Read/Write Loads", () => {
  bench("100 reads and 100 writes on a single property", () => {
    const store = createGrain({ count: 0 });
    let effectRuns = 0;

    const dispose = effect(() => {
      store.count;
      effectRuns++;
    });

    for (let i = 0; i < 100; i++) {
      update(store, { $set: { count: i } });
      store.count; // Read after write
    }

    dispose();
  });
});

describe("Additional: Complex Object Structures", () => {
  interface User {
    id: number;
    name: string;
    profile: {
      email: string;
      age: number;
      settings: {
        theme: "dark" | "light";
        notifications: boolean;
      };
    };
    posts: { id: number; title: string; likes: number }[];
  }

  bench("Nested object and array updates", () => {
    const user = createGrain<User>({
      id: 1,
      name: "John Doe",
      profile: {
        email: "john@example.com",
        age: 30,
        settings: { theme: "light", notifications: true },
      },
      posts: [
        { id: 1, title: "First Post", likes: 10 },
        { id: 2, title: "Second Post", likes: 25 },
      ],
    });

    let totalLikes = 0;
    effect(() => {
      totalLikes = user.posts.reduce((acc, p) => acc + p.likes, 0);
    });

    // Update nested property
    update(user, { $set: { "profile.settings.theme": "dark" } });

    // Add a new post
    update(user, { $push: { posts: { id: 3, title: "Third Post", likes: 5 } } });

    // Update an item in the array
    update(user, { $inc: { "posts.0.likes": 1 } });

    // Replace a nested object
    update(user, { $set: { "profile.age": 31 } });
    void totalLikes;
  });
});

describe("Additional: Circular Dependencies", () => {
  interface CircularNode {
    id: number;
    value: number;
    next: CircularNode | null;
    prev: CircularNode | null;
  }

  bench("Create and update circular list", () => {
    const store = createGrain({
      nodes: Array.from(
        { length: 10 },
        (_, i): CircularNode => ({
          id: i,
          value: i,
          next: null,
          prev: null,
        }),
      ),
    });

    // Link nodes circularly
    const linkedNodes = store.nodes.map((node, i) => ({
      ...node,
      next: store.nodes[(i + 1) % 10] || null,
      prev: store.nodes[(i + 9) % 10] || null,
    }));
    update(store, { $set: { nodes: linkedNodes } });

    // Traverse and update
    let current = store.nodes[0];
    const updates: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      if (current) {
        updates[`nodes.${current.id}.value`] = current.value + 1;
        current = current.next!; // We know it's not null in a circular list
      }
    }
    update(store, { $inc: updates });
  });
});
