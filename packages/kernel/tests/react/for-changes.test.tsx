import { batch, createReactive, computedList } from "@supergrain/kernel";
import { For, tracked } from "@supergrain/kernel/react";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `<For>` must show every change to which items are where, in both modes:
 * replacing an item in place, several items moving at once, and items
 * shifting up a slot (a sorted, windowed list). Rows that only moved keep
 * their components.
 */

afterEach(() => cleanup());

interface Item {
  id: number;
  label: string;
}

const items = (...ids: number[]): Item[] => ids.map((id) => ({ id, label: `i${id}` }));

const unwrapIds = (data: ReadonlyArray<Item>): string => data.map((item) => item.label).join("");

let rowRenders = 0;
const Row = tracked(({ item }: { item: Item }) => {
  rowRenders++;
  return <li>{item.label}</li>;
});

function mount(list: () => ReadonlyArray<Item>, withParent: boolean) {
  const List = tracked(() => {
    const ul = React.useRef<HTMLUListElement>(null);
    return (
      <ul ref={ul}>
        <For each={list()} {...(withParent && { parent: ul })}>
          {(item: Item) => <Row key={item.id} item={item} />}
        </For>
      </ul>
    );
  });
  const { container } = render(<List />);
  return () => container.textContent;
}

for (const withParent of [false, true]) {
  describe(`For ${withParent ? "with" : "without"} parent`, () => {
    it("shows an item replaced in place", async () => {
      const store = createReactive({ data: items(1, 2, 3) });
      const shown = mount(() => store.data, withParent);

      await act(async () => {
        store.data[1] = { id: 9, label: "i9" };
      });
      expect(shown()).toBe("i1i9i3");
    });

    it("shows two items replaced by new ones (not a swap)", async () => {
      const store = createReactive({ data: items(1, 2, 3) });
      const shown = mount(() => store.data, withParent);

      await act(async () => {
        store.data[0] = { id: 7, label: "i7" };
        store.data[2] = { id: 8, label: "i8" };
      });
      expect(shown()).toBe("i7i2i8");
    });

    it("shows a swap in an array with a hole", async () => {
      const data = items(1, 2, 3, 4);
      delete data[1];
      const store = createReactive({ data });
      const shown = mount(() => store.data, withParent);

      await act(async () => {
        batch(() => {
          const third = store.data[2]!;
          store.data[2] = store.data[3]!;
          store.data[3] = third;
        });
      });
      expect(shown()).toBe("i1i4i3");
    });

    it("shows a swap, and only the swapped rows' order changes", async () => {
      const store = createReactive({ data: items(1, 2, 3, 4) });
      const shown = mount(() => store.data, withParent);

      rowRenders = 0;
      await act(async () => {
        const first = store.data[0]!;
        store.data[0] = store.data[3]!;
        store.data[3] = first;
      });
      expect(shown()).toBe("i4i2i3i1");
      expect(rowRenders).toBe(0);
    });

    it("shows three items rotating in one batch", async () => {
      const store = createReactive({ data: items(1, 2, 3, 4) });
      const shown = mount(() => store.data, withParent);

      await act(async () => {
        const [a, b, c] = [store.data[0]!, store.data[1]!, store.data[2]!];
        store.data[0] = c;
        store.data[1] = a;
        store.data[2] = b;
      });
      expect(shown()).toBe("i3i1i2i4");
    });

    it("re-renders only the new row when items shift up a slot", async () => {
      const store = createReactive({ data: items(1, 2, 3, 4) });
      const shown = mount(() => store.data, withParent);

      rowRenders = 0;
      await act(async () => {
        // Same length, every slot changes: what a sliding window does.
        store.data.splice(0, 1);
        store.data.push({ id: 5, label: "i5" });
      });
      expect(shown()).toBe("i2i3i4i5");
      expect(rowRenders).toBe(1);
    });

    it("keeps the components of rows without an id that only moved", async () => {
      interface Pair {
        item: Item;
      }
      let pairRenders = 0;
      const PairRow = tracked(({ pair }: { pair: Pair }) => {
        pairRenders++;
        return <li>{pair.item.label}</li>;
      });
      const store = createReactive({ data: items(1, 2, 3, 4).map((item) => ({ item })) });
      const List = tracked(() => {
        const ul = React.useRef<HTMLUListElement>(null);
        return (
          <ul ref={ul}>
            <For each={store.data} {...(withParent && { parent: ul })}>
              {(pair: Pair) => <PairRow key={pair.item.id} pair={pair} />}
            </For>
          </ul>
        );
      });
      const { container } = render(<List />);

      pairRenders = 0;
      await act(async () => {
        store.data.splice(0, 1);
        store.data.push({ item: { id: 5, label: "i5" } });
      });
      expect(container.textContent).toBe("i2i3i4i5");
      expect(pairRenders).toBe(1);

      if (withParent) return; // There, `children`' own keys must be unique.
      // The same object twice still shows twice.
      await act(async () => {
        store.data.push(store.data[0]!);
      });
      expect(container.textContent).toBe("i2i3i4i5i2");
    });

    it("shows a computedList losing its last row", async () => {
      const store = createReactive({
        data: items(1, 2, 3).map((item) => ({ ...item, on: true })),
      });
      const on = computedList(() => store.data).filter((item) => item.on);
      const shown = mount(on, withParent);

      await act(async () => {
        store.data[2]!.on = false;
      });
      expect(shown()).toBe("i1i2");
    });

    it("keeps a computedList's top 3 in sync", async () => {
      const store = createReactive({
        tasks: Array.from({ length: 20 }, (_, id) => ({ id, label: `t${id}`, done: false })),
      });
      const top = computedList(() => store.tasks)
        .filter((task) => !task.done)
        .orderBy((task) => task.id)
        .limit(3);
      const shown = mount(top, withParent);
      expect(shown()).toBe("t0t1t2");

      rowRenders = 0;
      await act(async () => {
        store.tasks[0]!.done = true;
      });
      expect(shown()).toBe("t1t2t3");
      expect(rowRenders).toBe(1);

      await act(async () => {
        store.tasks[0]!.done = false;
        store.tasks[2]!.done = true;
      });
      expect(shown()).toBe("t0t1t3");

      await act(async () => {
        store.tasks[1]!.label = "renamed";
      });
      expect(shown()).toBe("t0renamedt3");
    });
  });
}

describe("For with parent: edge cases", () => {
  function mountWithParent(data: Item[], parent?: React.RefObject<Element | null>) {
    const List = tracked(() => {
      const ul = React.useRef<HTMLUListElement>(null);
      return (
        <ul ref={ul}>
          <For each={data} parent={parent ?? ul}>
            {(item: Item) => <Row key={item.id} item={item} />}
          </For>
        </ul>
      );
    });
    const { container } = render(<List />);
    return () => container.textContent;
  }

  it("does nothing when a swap is undone in the same batch", async () => {
    const store = createReactive({ data: items(1, 2, 3) });
    const shown = mountWithParent(store.data);

    rowRenders = 0;
    await act(async () => {
      const [a, c] = [store.data[0]!, store.data[2]!];
      store.data[0] = c;
      store.data[2] = a;
      store.data[0] = a;
      store.data[2] = c;
    });
    expect(shown()).toBe("i1i2i3");
    expect(rowRenders).toBe(0);
  });

  it("shows a replacement and an append made in the same batch", async () => {
    const store = createReactive({ data: items(1, 2, 3) });
    const shown = mountWithParent(store.data);

    await act(async () => {
      batch(() => {
        store.data[0] = { id: 9, label: "i9" };
        store.data.push({ id: 4, label: "i4" });
      });
    });
    expect(shown()).toBe("i9i2i3i4");
  });

  it("shows an item moved into a replaced item's slot (not a swap)", async () => {
    const store = createReactive({ data: items(1, 2, 3) });
    const shown = mountWithParent(store.data);

    await act(async () => {
      batch(() => {
        store.data[0] = store.data[1]!;
        store.data[1] = { id: 9, label: "i9" };
      });
    });
    expect(shown()).toBe("i2i9i3");
  });

  it("shows a swap written one slot at a time, outside a batch", async () => {
    const store = createReactive({ data: items(1, 2, 3) });
    const shown = mountWithParent(store.data);

    // The first write alone isn't a swap, so `For` re-renders; the second
    // then looks like one, but `For` must not move nodes React is about to
    // place itself.
    await act(async () => {
      const first = store.data[0]!;
      store.data[0] = store.data[2]!;
      store.data[2] = first;
    });
    expect(shown()).toBe("i3i2i1");
  });

  it("re-renders correctly after a swap it made by moving nodes", async () => {
    const store = createReactive({ data: items(2, 3, 1) });
    const shown = mountWithParent(store.data);

    await act(async () => {
      batch(() => {
        const first = store.data[0]!;
        store.data[0] = store.data[2]!;
        store.data[2] = first;
      });
    });
    expect(shown()).toBe("i1i3i2");
    // React still has the rows in their old order. Its next render must
    // place them from that order, not from the moved nodes.
    await act(async () => {
      store.data.sort((a, b) => b.id - a.id);
    });
    expect(shown()).toBe("i3i2i1");
  });

  it("re-renders a swap when the parent element isn't mounted", async () => {
    const store = createReactive({ data: items(1, 2, 3) });
    const detached: React.RefObject<Element | null> = { current: null };
    const shown = mountWithParent(store.data, detached);

    await act(async () => {
      const first = store.data[0]!;
      store.data[0] = store.data[2]!;
      store.data[2] = first;
    });
    expect(shown()).toBe("i3i2i1");
  });

  const swapEnds = (data: Array<{ id: number }>) => {
    const first = data[0]!;
    data[0] = data.at(-1)! as never;
    data[data.length - 1] = first as never;
  };

  it("re-renders correctly after a swapped row stopped rendering", async () => {
    const store = createReactive({ data: items(1, 2, 3), hidden: 0 });
    const Hideable = tracked(({ item }: { item: Item }) =>
      store.hidden === item.id ? null : <li>{item.label}</li>,
    );
    const List = tracked(() => {
      const ul = React.useRef<HTMLUListElement>(null);
      return (
        <ul ref={ul}>
          <For each={store.data} parent={ul}>
            {(item: Item) => <Hideable key={item.id} item={item} />}
          </For>
        </ul>
      );
    });
    const { container } = render(<List />);
    await act(async () => {
      batch(() => swapEnds(store.data));
    });
    expect(container.textContent).toBe("i3i2i1");
    // The row now in the middle of the swap stops rendering, without `For`.
    await act(async () => {
      store.hidden = 1;
    });
    expect(container.textContent).toBe("i3i2");
    await act(async () => {
      store.data.push({ id: 4, label: "i4" });
    });
    expect(container.textContent).toBe("i3i2i4");
    await act(async () => {
      store.hidden = 0;
    });
    expect(container.textContent).toBe("i3i2i1i4");
  });

  it("re-renders correctly after many swaps", async () => {
    const store = createReactive({ data: items(1, 2, 3, 4, 5) });
    const shown = mountWithParent(store.data);
    for (let i = 0; i < 41; i++) {
      await act(async () => {
        batch(() => {
          const a = i % 5;
          const b = (i * 3 + 1) % 5;
          if (a === b) return;
          const first = store.data[a]!;
          store.data[a] = store.data[b]!;
          store.data[b] = first;
        });
      });
    }
    const order = () => unwrapIds(store.data);
    expect(shown()).toBe(order());
    await act(async () => {
      store.data.push({ id: 6, label: "i6" });
    });
    expect(shown()).toBe(order());
  });

  it("leaves a swap on screen when a render that would undo it suspends", async () => {
    const store = createReactive({ data: items(1, 2, 3), waiting: false, tick: 0 });
    const never = new Promise<never>(() => {});
    const Waits = tracked(() => {
      if (store.waiting) throw never;
      return null;
    });
    const List = tracked(() => {
      const ul = React.useRef<HTMLUListElement>(null);
      void store.tick;
      return (
        <>
          <ul ref={ul}>
            <For each={store.data} parent={ul}>
              {(item: Item) => <Row key={item.id} item={item} />}
            </For>
          </ul>
          <Waits />
        </>
      );
    });
    const { container } = render(
      <React.Suspense fallback={<i>loading</i>}>
        <List />
      </React.Suspense>,
    );
    await act(async () => {
      batch(() => swapEnds(store.data));
    });
    expect(container.textContent).toBe("i3i2i1");
    // `For` renders in this transition, then `Waits` suspends it: React
    // keeps the screen, which must still show the swap.
    await act(async () => {
      React.startTransition(() => {
        batch(() => {
          store.tick++;
          store.waiting = true;
        });
      });
    });
    expect(container.textContent).toBe("i3i2i1");
    await act(async () => {
      React.startTransition(() => {
        store.waiting = false;
      });
    });
    expect(container.textContent).toBe("i3i2i1");
    await act(async () => {
      store.data.push({ id: 4, label: "i4" });
    });
    expect(container.textContent).toBe("i3i2i1i4");
  });
});

describe("For without parent", () => {
  it("doesn't call children again for rows that only moved", async () => {
    const store = createReactive({ data: items(1, 2, 3, 4) });
    let calls = 0;
    const List = tracked(() => (
      <ul>
        <For each={store.data}>
          {(item: Item) => {
            calls++;
            return <li key={item.id}>{item.label}</li>;
          }}
        </For>
      </ul>
    ));
    const { container } = render(<List />);

    calls = 0;
    await act(async () => {
      store.data.splice(0, 1);
      store.data.push({ id: 5, label: "i5" });
    });
    expect(container.textContent).toBe("i2i3i4i5");
    expect(calls).toBe(1);
  });

  it("passes each row its current index", async () => {
    const store = createReactive({ data: items(1, 2, 3) });
    const List = tracked(() => (
      <ul>
        <For each={store.data}>
          {(item: Item, index) => (
            <li key={item.id}>
              {index}:{item.label}
            </li>
          )}
        </For>
      </ul>
    ));
    const { container } = render(<List />);

    await act(async () => {
      store.data.splice(0, 1);
    });
    expect(container.textContent).toBe("0:i21:i3");
  });
});

describe("For without parent: items that aren't objects", () => {
  it("keys primitives, falsy ones included, by position", () => {
    const store = createReactive({ data: [0, "", "b", null] as Array<unknown> });
    const List = tracked(() => (
      <ul>
        <For each={store.data}>{(value) => <li>{String(value)}</li>}</For>
      </ul>
    ));
    const { container } = render(<List />);
    expect(container.textContent).toBe("0bnull");
  });
});

describe("For without parent: ids that can't be keys", () => {
  it("keys items whose id isn't a string or number by identity", async () => {
    const store = createReactive({
      data: [
        { id: undefined, label: "a" },
        { id: null, label: "b" },
        { id: {}, label: "c" },
      ],
    });
    let calls = 0;
    const List = tracked(() => (
      <ul>
        <For each={store.data}>
          {(item) => {
            calls++;
            return <li>{item.label}</li>;
          }}
        </For>
      </ul>
    ));
    const { container } = render(<List />);
    calls = 0;
    await act(async () => {
      store.data.reverse();
    });
    expect(container.textContent).toBe("cba");
    // Every row only moved, so none calls `children` again.
    expect(calls).toBe(0);
  });
});

describe("For without parent: keys React would treat as equal", () => {
  it('shows both items when one id is 1 and the other is "1"', () => {
    const store = createReactive({
      data: [
        { id: 1 as number | string, label: "a" },
        { id: "1" as number | string, label: "b" },
      ],
    });
    const List = tracked(() => (
      <ul>
        <For each={store.data}>{(item) => <li>{item.label}</li>}</For>
      </ul>
    ));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<List />);
    // No "two children with the same key" warning.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    expect(container.textContent).toBe("ab");
  });
});
