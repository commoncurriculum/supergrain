import { createStore, computed } from "@supergrain/core";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, useComputed } from "../src/index";

afterEach(() => cleanup());

describe("useComputed()", () => {
  it("returns a derived value from store state", async () => {
    const store = createStore({ count: 2 });

    const Display = tracked(() => {
      const doubled = useComputed(() => store.count * 2);
      return <span data-testid="val">{doubled}</span>;
    });

    const { getByTestId } = render(<Display />);
    expect(getByTestId("val").textContent).toBe("4");
  });

  it("updates when the derived value changes", async () => {
    const store = createStore({ count: 2 });

    const Display = tracked(() => {
      const doubled = useComputed(() => store.count * 2);
      return <span data-testid="val">{doubled}</span>;
    });

    const { getByTestId } = render(<Display />);
    await act(async () => {
      store.count = 5;
    });
    expect(getByTestId("val").textContent).toBe("10");
  });

  it("acts as a firewall — skips re-render when derived value is unchanged", async () => {
    const store = createStore<{ selected: number | null }>({ selected: null });
    let renders = 0;

    const Row = tracked(({ id }: { id: number }) => {
      renders++;
      const isSelected = useComputed(() => store.selected === id);
      return <div data-testid={`row-${id}`}>{isSelected ? "yes" : "no"}</div>;
    });

    render(
      <>
        <Row id={1} />
        <Row id={2} />
        <Row id={3} />
      </>,
    );
    expect(renders).toBe(3);

    // Select row 2 — only row 2 should re-render (null→false is same for 1 and 3)
    // Actually null === 1 is false, and 2 === 1 is also false, so row 1 shouldn't re-render
    // But null === 2 is false, and 2 === 2 is true, so row 2 SHOULD re-render
    await act(async () => {
      store.selected = 2;
    });
    // 3 initial + 1 (row 2 changed from false→true) = 4
    expect(renders).toBe(4);

    // Change selection from 2 → 3: row 2 (true→false) and row 3 (false→true) re-render
    await act(async () => {
      store.selected = 3;
    });
    expect(renders).toBe(6);
  });

  it("works with proxy props (no store injection needed)", async () => {
    const store = createStore({
      items: [
        { id: 1, label: "hello" },
        { id: 2, label: "world" },
      ],
    });

    const Item = tracked(({ item }: { item: { id: number; label: string } }) => {
      const upper = useComputed(() => item.label.toUpperCase());
      return <span data-testid={`item-${item.id}`}>{upper}</span>;
    });

    const { getByTestId } = render(
      <>
        <Item item={store.items[0]} />
        <Item item={store.items[1]} />
      </>,
    );

    expect(getByTestId("item-1").textContent).toBe("HELLO");

    await act(async () => {
      store.items[0].label = "changed";
    });
    expect(getByTestId("item-1").textContent).toBe("CHANGED");
    expect(getByTestId("item-2").textContent).toBe("WORLD"); // unchanged
  });

  it("accepts deps array and recomputes when deps change", async () => {
    const store = createStore<{ selected: number | null }>({ selected: null });
    let renders = 0;

    const Row = ({ id }: { id: number }) => {
      renders++;
      const isSelected = useComputed(() => store.selected === id, [id]);
      return <div>{isSelected ? "yes" : "no"}</div>;
    };

    const { rerender } = render(<Row id={1} />);
    expect(renders).toBe(1);

    // Re-render with different id — should create a new computed
    rerender(<Row id={2} />);
    expect(renders).toBe(2);
  });
});
