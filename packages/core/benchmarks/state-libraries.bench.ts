import { bench, describe } from "vitest";
import { createStore } from "../src";
import { effect } from "alien-signals";
import { createStore as createZustandStore } from "zustand/vanilla";
import { createStore as createJotaiStore, atom } from "jotai/vanilla";
import { observable, autorun, runInAction } from "mobx";
import { proxy, subscribe, snapshot } from "valtio/vanilla";
import {
  signal as preactSignal,
  effect as preactEffect,
  batch as preactBatch,
} from "@preact/signals-core";

/**
 * Cross-library benchmarks comparing @supergrain/core against
 * zustand, jotai, valtio, mobx, and @preact/signals-core.
 *
 * All libraries are used in their "vanilla" (non-React) mode to
 * measure raw store/reactivity performance without framework overhead.
 *
 * Note: Preact signals-core provides individual signals, not a store
 * abstraction. Benchmarks compose signals to match equivalent operations.
 */

// ---------------------------------------------------------------------------
// Store Creation
// ---------------------------------------------------------------------------

describe("Store Creation: create 1000 stores", () => {
  bench("@supergrain/core", () => {
    for (let i = 0; i < 1000; i++) {
      createStore({ id: i, name: `Item ${i}`, nested: { count: i } });
    }
  });

  bench("zustand", () => {
    for (let i = 0; i < 1000; i++) {
      createZustandStore(() => ({
        id: i,
        name: `Item ${i}`,
        nested: { count: i },
      }));
    }
  });

  bench("jotai", () => {
    const store = createJotaiStore();
    for (let i = 0; i < 1000; i++) {
      const a = atom({ id: i, name: `Item ${i}`, nested: { count: i } });
      store.get(a);
    }
  });

  bench("valtio", () => {
    for (let i = 0; i < 1000; i++) {
      proxy({ id: i, name: `Item ${i}`, nested: { count: i } });
    }
  });

  bench("mobx", () => {
    for (let i = 0; i < 1000; i++) {
      observable({ id: i, name: `Item ${i}`, nested: { count: i } });
    }
  });

  bench("@preact/signals-core", () => {
    for (let i = 0; i < 1000; i++) {
      preactSignal({ id: i, name: `Item ${i}`, nested: { count: i } });
    }
  });
});

// ---------------------------------------------------------------------------
// Property Read (Non-reactive, 1M reads)
// ---------------------------------------------------------------------------

describe("Property Read: 1M non-reactive reads", () => {
  const [sgStore] = createStore({ user: { age: 30 } });

  const zStore = createZustandStore(() => ({ user: { age: 30 } }));

  const jStore = createJotaiStore();
  const jAtom = atom({ user: { age: 30 } });

  const vStore = proxy({ user: { age: 30 } });

  const mStore = observable({ user: { age: 30 } });

  const pStore = preactSignal({ user: { age: 30 } });

  bench("@supergrain/core", () => {
    for (let i = 0; i < 1_000_000; i++) {
      sgStore.user.age;
    }
  });

  bench("zustand", () => {
    for (let i = 0; i < 1_000_000; i++) {
      zStore.getState().user.age;
    }
  });

  bench("jotai", () => {
    for (let i = 0; i < 1_000_000; i++) {
      jStore.get(jAtom).user.age;
    }
  });

  bench("valtio", () => {
    for (let i = 0; i < 1_000_000; i++) {
      vStore.user.age;
    }
  });

  bench("mobx", () => {
    for (let i = 0; i < 1_000_000; i++) {
      mStore.user.age;
    }
  });

  bench("@preact/signals-core", () => {
    for (let i = 0; i < 1_000_000; i++) {
      pStore.value.user.age;
    }
  });
});

// ---------------------------------------------------------------------------
// Property Updates (Non-reactive, 1000 updates)
// ---------------------------------------------------------------------------

describe("Non-reactive Updates: 1000 updates", () => {
  bench("@supergrain/core", () => {
    const [, setStore] = createStore({ count: 0 });
    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i } });
    }
  });

  bench("zustand", () => {
    const store = createZustandStore<{ count: number }>((_set) => ({
      count: 0,
    }));
    for (let i = 0; i < 1000; i++) {
      store.setState({ count: i });
    }
  });

  bench("jotai", () => {
    const store = createJotaiStore();
    const countAtom = atom(0);
    for (let i = 0; i < 1000; i++) {
      store.set(countAtom, i);
    }
  });

  bench("valtio", () => {
    const state = proxy({ count: 0 });
    for (let i = 0; i < 1000; i++) {
      state.count = i;
    }
  });

  bench("mobx", () => {
    const state = observable({ count: 0 });
    for (let i = 0; i < 1000; i++) {
      runInAction(() => {
        state.count = i;
      });
    }
  });

  bench("@preact/signals-core", () => {
    const count = preactSignal(0);
    for (let i = 0; i < 1000; i++) {
      count.value = i;
    }
  });
});

// ---------------------------------------------------------------------------
// Reactive Updates: subscribe + 1000 updates
// ---------------------------------------------------------------------------

describe("Reactive Updates: subscribe + 1000 updates", () => {
  bench("@supergrain/core", async () => {
    const [store, setStore] = createStore({ count: 0 });
    const dispose = effect(() => {
      store.count;
    });
    for (let i = 0; i < 1000; i++) {
      setStore({ $set: { count: i } });
    }
    await new Promise<void>((r) => queueMicrotask(r));
    dispose();
  });

  bench("zustand", () => {
    const store = createZustandStore<{ count: number }>(() => ({ count: 0 }));
    const unsub = store.subscribe(() => {
      store.getState().count;
    });
    for (let i = 0; i < 1000; i++) {
      store.setState({ count: i });
    }
    unsub();
  });

  bench("jotai", () => {
    const store = createJotaiStore();
    const countAtom = atom(0);
    const unsub = store.sub(countAtom, () => {
      store.get(countAtom);
    });
    for (let i = 0; i < 1000; i++) {
      store.set(countAtom, i);
    }
    unsub();
  });

  bench("valtio", async () => {
    const state = proxy({ count: 0 });
    const unsub = subscribe(state, () => {
      snapshot(state).count;
    });
    for (let i = 0; i < 1000; i++) {
      state.count = i;
    }
    // Valtio batches notifications asynchronously
    await new Promise<void>((r) => queueMicrotask(r));
    unsub();
  });

  bench("mobx", () => {
    const state = observable({ count: 0 });
    const dispose = autorun(() => {
      state.count;
    });
    for (let i = 0; i < 1000; i++) {
      runInAction(() => {
        state.count = i;
      });
    }
    dispose();
  });

  bench("@preact/signals-core", () => {
    const count = preactSignal(0);
    const dispose = preactEffect(() => {
      count.value;
    });
    for (let i = 0; i < 1000; i++) {
      count.value = i;
    }
    dispose();
  });
});

// ---------------------------------------------------------------------------
// Batch Updates: update 10 properties at once
// ---------------------------------------------------------------------------

describe("Batch Update: 10 properties at once", () => {
  const keys = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const;
  type TenProps = Record<(typeof keys)[number], number>;
  const initial = (): TenProps => ({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0, i: 0, j: 0 });

  bench("@supergrain/core", async () => {
    const [store, setStore] = createStore(initial());
    const dispose = effect(() => {
      for (const k of keys) store[k];
    });
    setStore({ $set: { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 } });
    await new Promise<void>((r) => queueMicrotask(r));
    dispose();
  });

  bench("zustand", () => {
    const store = createZustandStore<TenProps>(() => initial());
    const unsub = store.subscribe(() => {
      const s = store.getState();
      for (const k of keys) s[k];
    });
    store.setState({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 });
    unsub();
  });

  bench("jotai", () => {
    const store = createJotaiStore();
    const a = atom(initial());
    const unsub = store.sub(a, () => {
      const s = store.get(a);
      for (const k of keys) s[k];
    });
    store.set(a, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 });
    unsub();
  });

  bench("valtio", async () => {
    const state = proxy(initial());
    const unsub = subscribe(state, () => {
      const s = snapshot(state);
      for (const k of keys) s[k];
    });
    state.a = 1;
    state.b = 2;
    state.c = 3;
    state.d = 4;
    state.e = 5;
    state.f = 6;
    state.g = 7;
    state.h = 8;
    state.i = 9;
    state.j = 10;
    await new Promise<void>((r) => queueMicrotask(r));
    unsub();
  });

  bench("mobx", () => {
    const state = observable(initial());
    const dispose = autorun(() => {
      for (const k of keys) state[k];
    });
    runInAction(() => {
      state.a = 1;
      state.b = 2;
      state.c = 3;
      state.d = 4;
      state.e = 5;
      state.f = 6;
      state.g = 7;
      state.h = 8;
      state.i = 9;
      state.j = 10;
    });
    dispose();
  });

  bench("@preact/signals-core", () => {
    const signals = Object.fromEntries(keys.map((k) => [k, preactSignal(0)])) as Record<
      (typeof keys)[number],
      ReturnType<typeof preactSignal<number>>
    >;
    const dispose = preactEffect(() => {
      for (const k of keys) signals[k].value;
    });
    preactBatch(() => {
      signals.a.value = 1;
      signals.b.value = 2;
      signals.c.value = 3;
      signals.d.value = 4;
      signals.e.value = 5;
      signals.f.value = 6;
      signals.g.value = 7;
      signals.h.value = 8;
      signals.i.value = 9;
      signals.j.value = 10;
    });
    dispose();
  });
});

// ---------------------------------------------------------------------------
// Deep Nested Updates
// ---------------------------------------------------------------------------

describe("Deep Updates: 100 nested property updates", () => {
  const deepState = () => ({ l1: { l2: { l3: { value: 0 } } } });

  bench("@supergrain/core", async () => {
    const [store, setStore] = createStore(deepState());
    const dispose = effect(() => {
      store.l1.l2.l3.value;
    });
    for (let i = 0; i < 100; i++) {
      setStore({ $set: { "l1.l2.l3.value": i } });
    }
    await new Promise<void>((r) => queueMicrotask(r));
    dispose();
  });

  bench("zustand", () => {
    const store = createZustandStore(() => deepState());
    const unsub = store.subscribe(() => {
      store.getState().l1.l2.l3.value;
    });
    for (let i = 0; i < 100; i++) {
      store.setState({ l1: { l2: { l3: { value: i } } } });
    }
    unsub();
  });

  bench("jotai", () => {
    const store = createJotaiStore();
    const a = atom(deepState());
    const unsub = store.sub(a, () => {
      store.get(a).l1.l2.l3.value;
    });
    for (let i = 0; i < 100; i++) {
      store.set(a, { l1: { l2: { l3: { value: i } } } });
    }
    unsub();
  });

  bench("valtio", async () => {
    const state = proxy(deepState());
    const unsub = subscribe(state, () => {
      snapshot(state).l1.l2.l3.value;
    });
    for (let i = 0; i < 100; i++) {
      state.l1.l2.l3.value = i;
    }
    await new Promise<void>((r) => queueMicrotask(r));
    unsub();
  });

  bench("mobx", () => {
    const state = observable(deepState());
    const dispose = autorun(() => {
      state.l1.l2.l3.value;
    });
    for (let i = 0; i < 100; i++) {
      runInAction(() => {
        state.l1.l2.l3.value = i;
      });
    }
    dispose();
  });

  bench("@preact/signals-core", () => {
    const deepValue = preactSignal(0);
    const dispose = preactEffect(() => {
      deepValue.value;
    });
    for (let i = 0; i < 100; i++) {
      deepValue.value = i;
    }
    dispose();
  });
});

// ---------------------------------------------------------------------------
// Array Push: 100 pushes
// ---------------------------------------------------------------------------

describe("Array Operations: 100 pushes with reactive subscriber", () => {
  bench("@supergrain/core", async () => {
    const [store, update] = createStore<{ items: number[] }>({ items: [] });
    const dispose = effect(() => {
      store.items.length;
    });
    for (let i = 0; i < 100; i++) {
      update({ $push: { items: i } });
    }
    await new Promise<void>((r) => queueMicrotask(r));
    dispose();
  });

  bench("zustand", () => {
    const store = createZustandStore<{ items: number[] }>(() => ({ items: [] }));
    const unsub = store.subscribe(() => {
      store.getState().items.length;
    });
    for (let i = 0; i < 100; i++) {
      store.setState((s) => ({ items: [...s.items, i] }));
    }
    unsub();
  });

  bench("jotai", () => {
    const store = createJotaiStore();
    const itemsAtom = atom<number[]>([]);
    const unsub = store.sub(itemsAtom, () => {
      store.get(itemsAtom).length;
    });
    for (let i = 0; i < 100; i++) {
      store.set(itemsAtom, (prev) => [...prev, i]);
    }
    unsub();
  });

  bench("valtio", async () => {
    const state = proxy<{ items: number[] }>({ items: [] });
    const unsub = subscribe(state, () => {
      snapshot(state).items.length;
    });
    for (let i = 0; i < 100; i++) {
      state.items.push(i);
    }
    await new Promise<void>((r) => queueMicrotask(r));
    unsub();
  });

  bench("mobx", () => {
    const state = observable<{ items: number[] }>({ items: [] });
    const dispose = autorun(() => {
      state.items.length;
    });
    for (let i = 0; i < 100; i++) {
      runInAction(() => {
        state.items.push(i);
      });
    }
    dispose();
  });

  bench("@preact/signals-core", () => {
    const items = preactSignal<number[]>([]);
    const dispose = preactEffect(() => {
      items.value.length;
    });
    for (let i = 0; i < 100; i++) {
      items.value = [...items.value, i];
    }
    dispose();
  });
});

// ---------------------------------------------------------------------------
// Granular Reactivity: update 1 of 10 observed properties
// ---------------------------------------------------------------------------

describe("Granular Reactivity: update 1 of 10 independently observed props", () => {
  bench("@supergrain/core", async () => {
    const data: Record<string, number> = {};
    for (let i = 0; i < 10; i++) data[`p${i}`] = i;
    const [store, setStore] = createStore(data);
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      disposers.push(
        effect(() => {
          store[`p${i}`];
        }),
      );
    }
    setStore({ $set: { p5: 999 } });
    await new Promise<void>((r) => queueMicrotask(r));
    disposers.forEach((d) => d());
  });

  bench("zustand (no granular — all subscribers fire)", () => {
    const data: Record<string, number> = {};
    for (let i = 0; i < 10; i++) data[`p${i}`] = i;
    const store = createZustandStore(() => ({ ...data }));
    const unsubs: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      unsubs.push(
        store.subscribe(() => {
          store.getState()[`p${i}`];
        }),
      );
    }
    store.setState({ p5: 999 });
    unsubs.forEach((u) => u());
  });

  bench("jotai (individual atoms)", () => {
    const store = createJotaiStore();
    const atoms = Array.from({ length: 10 }, (_, i) => atom(i));
    const unsubs: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      unsubs.push(
        store.sub(atoms[i]!, () => {
          store.get(atoms[i]!);
        }),
      );
    }
    store.set(atoms[5]!, 999);
    unsubs.forEach((u) => u());
  });

  bench("valtio", async () => {
    const state = proxy<Record<string, number>>({});
    for (let i = 0; i < 10; i++) state[`p${i}`] = i;
    const unsubs: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      // Valtio subscribe fires for any change on the proxy
      unsubs.push(
        subscribe(state, () => {
          snapshot(state)[`p${i}`];
        }),
      );
    }
    state["p5"] = 999;
    await new Promise<void>((r) => queueMicrotask(r));
    unsubs.forEach((u) => u());
  });

  bench("mobx", () => {
    const state = observable<Record<string, number>>({});
    for (let i = 0; i < 10; i++) state[`p${i}`] = i;
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      disposers.push(
        autorun(() => {
          state[`p${i}`];
        }),
      );
    }
    runInAction(() => {
      state["p5"] = 999;
    });
    disposers.forEach((d) => d());
  });

  bench("@preact/signals-core (individual signals)", () => {
    const signals = Array.from({ length: 10 }, (_, i) => preactSignal(i));
    const disposers: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      disposers.push(
        preactEffect(() => {
          signals[i]!.value;
        }),
      );
    }
    signals[5]!.value = 999;
    disposers.forEach((d) => d());
  });
});
