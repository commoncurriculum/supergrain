import { createReactive, effect } from "../../src";

export interface KernelLeaf {
  id: number;
  label: string;
  values: Array<number>;
}

export function makeLeaves(seed: number, width = 24): Array<KernelLeaf> {
  return Array.from({ length: width }, (_, index) => ({
    id: seed * 1_000 + index,
    label: `leaf-${seed}-${index}`,
    values: Array.from({ length: 16 }, (__, offset) => seed + index + offset),
  }));
}

export function runKernelCycle(seed: number): void {
  const state = createReactive({
    cursor: 0,
    leaves: makeLeaves(seed),
    nested: { depth: seed, flags: Array.from({ length: 8 }, (_, index) => index % 2 === 0) },
  });

  const stop = effect(() => {
    const current = state.leaves[state.cursor]!;
    void current.label;
    void current.values.reduce((sum, value) => sum + value, 0);
    void state.nested.depth;
    void state.nested.flags.filter(Boolean).length;
  });

  state.cursor = state.leaves.length - 1;
  state.leaves[0]!.label = `updated-${seed}`;
  state.nested.depth += 1;
  state.nested.flags = [...state.nested.flags].reverse();
  stop();
}

/**
 * Exercises array mutation methods with varying array shapes to stress
 * the batch/version-signal path used by array mutators.
 */
export function runArrayShapeCycle(seed: number): void {
  // Varies array length on each cycle (seed % 12 || 4 gives values 1-11 with
  // 4 as the fallback when seed is a multiple of 12) to exercise different
  // batch/version-signal code paths across both short and longer arrays.
  const state = createReactive({
    items: Array.from({ length: seed % 12 || 4 }, (_, index) => ({
      id: index,
      value: seed + index,
    })),
  });

  let sum = 0;
  const stop = effect(() => {
    sum = state.items.reduce((acc, item) => acc + item.value, 0);
  });

  state.items.push({ id: 999, value: seed });
  state.items.pop();
  state.items.splice(0, 1, { id: -1, value: seed * 2 });
  state.items.sort((a, b) => a.value - b.value);
  state.items.reverse();
  void sum;
  stop();
}

/**
 * Stresses nested-proxy read paths: many deeply nested objects accessed
 * inside an effect that is then discarded.
 */
export function runNestedReadCycle(seed: number): void {
  type Nested = { value: number; child?: Nested };

  function makeNested(depth: number, base: number): Nested {
    return depth === 0
      ? { value: base }
      : { value: base + depth, child: makeNested(depth - 1, base) };
  }

  const state = createReactive({
    root: makeNested(6, seed),
    list: Array.from({ length: 10 }, (_, index) => makeNested(3, seed + index)),
  });

  const stop = effect(() => {
    let n: Nested | undefined = state.root;
    while (n) {
      void n.value;
      n = n.child;
    }
    for (const item of state.list) {
      void item.value;
      void item.child?.value;
    }
  });

  // Mutate some nodes to exercise write paths too
  state.root.value = seed + 100;
  if (state.root.child) {
    state.root.child.value = seed + 200;
  }
  stop();
}
