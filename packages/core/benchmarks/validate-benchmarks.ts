import { createStore } from "../src";
import { effect } from "alien-signals";
import { createRoot, createEffect, createSignal, batch } from "solid-js/dist/solid.js";
import { createStore as createSolidStore } from "solid-js/store/dist/store.js";

// Helper to wait for microtasks to resolve
const nextTick = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

async function validatePropertyUpdates() {
  console.log("--- Validating: Property Updates with Effects ---");

  // @supergrain/core
  const [storableStore, setStorableStore] = createStore({ count: 0 });
  let storableRuns = 0;
  const storableDispose = effect(() => {
    storableRuns++;
    storableStore.count;
  });

  for (let i = 0; i < 1000; i++) {
    setStorableStore({ $set: { count: i + 1 } });
  }
  await nextTick();

  console.log(
    `[@supergrain/core] Sequential updates: Expected 2 runs, got ${storableRuns}.`,
    storableRuns === 2 ? "PASS" : "FAIL",
  );
  storableDispose();

  // solid-js
  await createRoot(async (dispose: () => void) => {
    const [signal, setSignal] = createSignal(0);
    let solidRuns = 0;
    createEffect(() => {
      solidRuns++;
      signal();
    });

    // Wait for initial effect run
    await nextTick();
    if (solidRuns !== 1) {
      console.warn(`[solid-js] Initial run count unexpected: ${solidRuns}`);
    }

    batch(() => {
      for (let i = 0; i < 1000; i++) {
        setSignal(i + 1);
      }
    });
    await nextTick();

    console.log(
      `[solid-js] Batched updates: Expected 2 runs, got ${solidRuns}.`,
      solidRuns === 2 ? "PASS" : "FAIL",
    );
    dispose();
  });
  console.log("--- Validation Complete ---\n");
}

async function validateDeepUpdates() {
  console.log("--- Validating: Deep Updates ---");
  const getDeepState = () => ({ l1: { l2: { l3: { value: 0 } } } });

  // @supergrain/core
  const [storableStore, setStorableStore] = createStore(getDeepState());
  let storableRuns = 0;
  const storableDispose = effect(() => {
    storableRuns++;
    storableStore.l1.l2.l3.value;
  });

  for (let i = 0; i < 100; i++) {
    setStorableStore({ $set: { "l1.l2.l3.value": i + 1 } });
  }
  await nextTick();
  console.log(
    `[@supergrain/core] Deep updates: Expected 2 runs, got ${storableRuns}.`,
    storableRuns === 2 ? "PASS" : "FAIL",
  );
  storableDispose();

  // solid-js/store (more comparable than a signal)
  await createRoot(async (dispose: () => void) => {
    const [solidStore, setSolidStore] = createSolidStore(getDeepState());
    let solidRuns = 0;
    createEffect(() => {
      solidRuns++;
      solidStore.l1.l2.l3.value;
    });

    // Wait for initial effect run
    await nextTick();
    if (solidRuns !== 1) {
      console.warn(`[solid-js] Initial run count unexpected: ${solidRuns}`);
    }

    // Solid's batching is implicit for store updates within the same sync task
    for (let i = 0; i < 100; i++) {
      setSolidStore("l1", "l2", "l3", "value", (v) => v + 1);
    }
    await nextTick();

    for (let i = 0; i < 100; i++) {
      setSolidStore("l1", "l2", "l3", "value", (v: number) => v + 1);
    }
    await nextTick();

    // It is expected for Solid to run this 101 times as it is not auto-batched.
    // The benchmark should use `batch` for a fair comparison.
    console.log(
      `[solid-js/store] Un-batched deep updates: Expected 101 runs, got ${solidRuns}.`,
      solidRuns === 101 ? "PASS" : "FAIL",
    );

    // Let's try again with batching for a fair comparison
    solidRuns = 0;
    const [solidStore2, setSolidStore2] = createSolidStore(getDeepState());
    createEffect(() => {
      solidRuns++;
      solidStore2.l1.l2.l3.value;
    });
    await nextTick(); // initial run

    batch(() => {
      for (let i = 0; i < 100; i++) {
        setSolidStore2("l1", "l2", "l3", "value", (v: number) => v + 1);
      }
    });
    await nextTick();
    console.log(
      `[solid-js/store] Batched deep updates: Expected 2 runs, got ${solidRuns}.`,
      solidRuns === 2 ? "PASS" : "FAIL",
    );

    dispose();
  });
  console.log("--- Validation Complete ---\n");
}

async function validateGranularReactivity() {
  console.log("--- Validating: Granular Reactivity ---");
  const getInitialData = () => {
    const data: any = {};
    for (let i = 0; i < 10; i++) data[`prop${i}`] = { nested: i };
    return data;
  };

  // @supergrain/core
  const [storableStore, setStorableStore] = createStore(getInitialData());
  const storableRuns = Array(10).fill(0);
  const storableDisposers: (() => void)[] = [];

  for (let i = 0; i < 10; i++) {
    const index = i;
    storableDisposers.push(
      effect(() => {
        storableStore[`prop${index}`].nested;
        storableRuns[index]++;
      }),
    );
  }
  await nextTick();
  console.log(`[@supergrain/core] Initial runs: ${storableRuns.join(", ")}`);

  setStorableStore({ $set: { "prop5.nested": 999 } });
  await nextTick();

  const storablePassed = storableRuns[5] === 2 && storableRuns.every((r, i) => i === 5 || r === 1);
  console.log(
    `[@supergrain/core] After update: Runs: ${storableRuns.join(", ")}.`,
    storablePassed ? "PASS" : "FAIL",
  );
  storableDisposers.forEach((d) => d());

  // solid-js/store
  await createRoot(async (dispose: () => void) => {
    const [solidStore, setSolidStore] = createSolidStore(getInitialData());
    const solidRuns = Array(10).fill(0);

    for (let i = 0; i < 10; i++) {
      const index = i;
      createEffect(() => {
        solidStore[`prop${index}`].nested;
        solidRuns[index]++;
      });
    }
    await nextTick();
    console.log(`[solid-js/store] Initial runs: ${solidRuns.join(", ")}`);

    setSolidStore("prop5", "nested", 999);
    await nextTick();

    const solidPassed = solidRuns[5] === 2 && solidRuns.every((r, i) => i === 5 || r === 1);
    console.log(
      `[solid-js/store] After update: Runs: ${solidRuns.join(", ")}.`,
      solidPassed ? "PASS" : "FAIL",
    );
    dispose();
  });
  console.log("--- Validation Complete ---\n");
}

async function runValidations() {
  console.log("Running Benchmark Validation Script...\n");
  await validatePropertyUpdates();
  await validateDeepUpdates();
  await validateGranularReactivity();
  console.log("All validation checks are complete.");
}

runValidations();
