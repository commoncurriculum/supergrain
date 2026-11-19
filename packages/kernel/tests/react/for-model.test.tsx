import { batch, computedList, createReactive } from "@supergrain/kernel";
import { For, tracked } from "@supergrain/kernel/react";
import { act, cleanup, render } from "@testing-library/react";
import fc from "fast-check";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `<For>` against a plain re-render: after any writes to the array it shows,
 * it must show what `.map()` over the array would. Writes are drawn from
 * every kind of array write, batched or not, and the array is either a store
 * array or a `computedList` over one.
 *
 * With `parent`, the elements `children` returns are rendered as they are, so
 * their keys are the caller's: an item held twice gives two equal keys, as it
 * would with `.map()`. Those runs never repeat an item.
 */

afterEach(() => cleanup());

interface Item {
  id: number;
  label: string;
}

type Write =
  | { kind: "set"; index: number; from: number }
  | { kind: "length"; value: number }
  | { kind: "delete"; index: number }
  | { kind: "push" | "unshift"; count: number }
  | { kind: "pop" | "shift" | "reverse" | "sort" }
  | { kind: "splice"; start: number; remove: number; add: number }
  | { kind: "rename"; index: number }
  | { kind: "swap"; a: number; b: number };

const small = fc.nat({ max: 6 });
const write: fc.Arbitrary<Write> = fc.oneof(
  // `from` -1 is a new item; otherwise a copy of the item at that index.
  fc.record({
    kind: fc.constant("set" as const),
    index: small,
    from: fc.integer({ min: -1, max: 5 }),
  }),
  fc.record({ kind: fc.constant("length" as const), value: small }),
  fc.record({ kind: fc.constant("delete" as const), index: small }),
  fc.record({
    kind: fc.constantFrom("push" as const, "unshift" as const),
    count: fc.nat({ max: 3 }),
  }),
  fc.record({
    kind: fc.constantFrom("pop" as const, "shift" as const, "reverse" as const, "sort" as const),
  }),
  fc.record({
    kind: fc.constant("splice" as const),
    start: small,
    remove: small,
    add: fc.nat({ max: 3 }),
  }),
  fc.record({ kind: fc.constant("rename" as const), index: small }),
  fc.record({ kind: fc.constant("swap" as const), a: small, b: small }),
);

let nextId = 0;
const newItem = (): Item => {
  const id = nextId++;
  return { id, label: `i${id}` };
};

/** `repeats`: whether a write may put an item in the array twice. */
function apply(list: Array<Item>, w: Write, repeats: boolean): void {
  switch (w.kind) {
    case "set":
      list[w.index] =
        !repeats || w.from < 0 || list[w.from] === undefined ? newItem() : list[w.from]!;
      break;
    case "length":
      list.length = w.value;
      break;
    case "delete":
      delete list[w.index];
      break;
    case "push":
    case "unshift":
      list[w.kind](...Array.from({ length: w.count }, newItem));
      break;
    case "pop":
    case "shift":
    case "reverse":
      list[w.kind]();
      break;
    case "sort":
      list.sort((a, b) => b.id - a.id);
      break;
    case "splice":
      list.splice(w.start, w.remove, ...Array.from({ length: w.add }, newItem));
      break;
    case "swap": {
      // In one batch, so the array never holds an item twice in between.
      if (!(w.a in list) || !(w.b in list)) break;
      batch(() => {
        const first = list[w.a]!;
        list[w.a] = list[w.b]!;
        list[w.b] = first;
      });
      break;
    }
    case "rename": {
      const item = list[w.index];
      if (item) item.label = `${item.label}'`;
      break;
    }
  }
}

const Row = tracked(({ item }: { item: Item }) => <li>{item.label}</li>);

for (const withParent of [false, true]) {
  describe(`For ${withParent ? "with" : "without"} parent matches a plain re-render`, () => {
    for (const viaList of [false, true]) {
      it(viaList ? "over a computedList" : "over a store array", async () => {
        await fc.assert(
          fc.asyncProperty(
            // The starting items, `false` for a hole.
            fc.array(fc.boolean(), { maxLength: 6 }),
            fc.array(fc.array(write, { minLength: 1, maxLength: 3 }), { maxLength: 4 }),
            fc.boolean(),
            async (initial, steps, batched) => {
              const data: Array<Item> = [];
              initial.forEach((present, i) => {
                if (present) data[i] = newItem();
              });
              data.length = initial.length;
              const store = createReactive({ data });
              const odd = computedList(() => store.data).filter((item) => item.id % 2 === 1);
              const each = (): ReadonlyArray<Item> => (viaList ? odd() : store.data);
              const List = tracked(() => {
                const ul = React.useRef<HTMLUListElement>(null);
                return (
                  <ul ref={ul}>
                    <For each={each()} {...(withParent && { parent: ul })}>
                      {(item: Item) => <Row key={item.id} item={item} />}
                    </For>
                  </ul>
                );
              });
              const { container, unmount } = render(<List />);
              const expected = () =>
                each()
                  .map((item) => item.label)
                  .join("");
              try {
                for (const writes of steps) {
                  await act(async () => {
                    const run = () => {
                      for (const w of writes) apply(store.data, w, !withParent);
                    };
                    if (batched) batch(run);
                    else run();
                  });
                  expect({ steps, shown: container.textContent }).toEqual({
                    steps,
                    shown: expected(),
                  });
                }
              } finally {
                unmount();
              }
            },
          ),
          { numRuns: 100 },
        );
      });
    }
  });
}
