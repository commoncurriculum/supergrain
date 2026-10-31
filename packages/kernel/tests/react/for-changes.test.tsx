import { batch, createReactive, computedList } from "@supergrain/kernel";
import { For, tracked } from "@supergrain/kernel/react";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";

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

    it("keeps a computedList's top 3 in sync", async () => {
      const store = createReactive({
        tasks: Array.from({ length: 20 }, (_, id) => ({ id, label: `t${id}`, done: false })),
      });
      const top = computedList({
        from: () => store.tasks,
        where: (task) => !task.done,
        orderBy: (task) => task.id,
        limit: 3,
      });
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
