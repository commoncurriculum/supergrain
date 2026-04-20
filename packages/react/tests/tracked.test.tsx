import { createReactive } from "@supergrain/core";
import { render, cleanup, act } from "@testing-library/react";
import React, { useCallback } from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, For } from "../src/index";

afterEach(() => cleanup());

interface RowData {
  id: number;
  label: string;
}
interface AppState {
  data: RowData[];
  selected: number | null;
}

function getRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tr")).map((tr) => {
    const tds = tr.querySelectorAll("td");
    return {
      id: tds[0]?.textContent ?? "",
      label: tds[1]?.textContent ?? "",
      className: tr.className,
    };
  });
}

describe("tracked()", () => {
  describe("per-component scoping", () => {
    it("label change re-renders only the affected Row, not App", async () => {
      const store = createReactive<AppState>({ data: [], selected: null });
      let appRenders = 0;
      let row1Renders = 0;
      let row2Renders = 0;

      const Row = tracked(({ item, label }: { item: RowData; label: string }) => {
        if (item.id === 1) row1Renders++;
        if (item.id === 2) row2Renders++;
        return (
          <tr>
            <td>{item.id}</td>
            <td>{item.label}</td>
          </tr>
        );
      });

      const App = tracked(() => {
        appRenders++;
        return (
          <For each={store.data}>
            {(item: RowData) => <Row key={item.id} item={item} label={item.label} />}
          </For>
        );
      });

      const { container } = render(
        <table>
          <tbody>
            <App />
          </tbody>
        </table>,
      );
      await act(async () => {
        store.data = [
          { id: 1, label: "one" },
          { id: 2, label: "two" },
        ];
      });

      const appAfter = appRenders;
      const row1After = row1Renders;
      const row2After = row2Renders;

      // Change only row 1's label
      await act(async () => {
        store.data[0].label = "ONE UPDATED";
      });

      expect(row1Renders).toBe(row1After + 1); // Row 1 re-rendered exactly once
      expect(row2Renders).toBe(row2After); // Row 2 did NOT
      expect(appRenders).toBe(appAfter); // App did NOT

      const rows = getRows(container.querySelector("tbody")!);
      expect(rows[0].label).toBe("ONE UPDATED");
      expect(rows[1].label).toBe("two");
    });

    it("selection change re-renders App (reads selected) but only affected Rows via memo", async () => {
      const store = createReactive<AppState>({ data: [], selected: null });
      let appRenders = 0;

      const Row = tracked(({ item, isSelected }: { item: RowData; isSelected: boolean }) => {
        return (
          <tr className={isSelected ? "danger" : ""}>
            <td>{item.id}</td>
            <td>{item.label}</td>
          </tr>
        );
      });

      const App = tracked(() => {
        appRenders++;
        const selected = store.selected;
        return (
          <For each={store.data}>
            {(item: RowData) => <Row key={item.id} item={item} isSelected={selected === item.id} />}
          </For>
        );
      });

      const { container } = render(
        <table>
          <tbody>
            <App />
          </tbody>
        </table>,
      );
      await act(async () => {
        store.data = [
          { id: 1, label: "one" },
          { id: 2, label: "two" },
          { id: 3, label: "three" },
        ];
      });

      await act(async () => {
        store.selected = 2;
      });

      const rows = getRows(container.querySelector("tbody")!);
      expect(rows[0].className).toBe("");
      expect(rows[1].className).toBe("danger");
      expect(rows[2].className).toBe("");
    });
  });

  describe("structural operations", () => {
    let store: any;
    let container: HTMLElement;

    function setup() {
      const s = createReactive<AppState>({ data: [], selected: null });
      store = s;

      const Row = tracked(({ item, isSelected }: { item: RowData; isSelected: boolean }) => {
        return (
          <tr className={isSelected ? "danger" : ""}>
            <td>{item.id}</td>
            <td>{item.label}</td>
          </tr>
        );
      });

      const App = tracked(() => {
        const selected = store.selected;
        return (
          <For each={store.data}>
            {(item: RowData) => <Row key={item.id} item={item} isSelected={selected === item.id} />}
          </For>
        );
      });

      const result = render(
        <table>
          <tbody>
            <App />
          </tbody>
        </table>,
      );
      container = result.container.querySelector("tbody")!;
    }

    it("create rows", async () => {
      setup();
      await act(async () => {
        store.data = [
          { id: 1, label: "a" },
          { id: 2, label: "b" },
        ];
      });
      expect(getRows(container)).toHaveLength(2);
      expect(getRows(container)[0]).toEqual({ id: "1", label: "a", className: "" });
    });

    it("replace all rows", async () => {
      setup();
      await act(async () => {
        store.data = [{ id: 1, label: "a" }];
      });
      await act(async () => {
        store.data = [{ id: 10, label: "x" }];
      });
      const rows = getRows(container);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("10");
    });

    it("partial update modifies every 10th row", async () => {
      setup();
      await act(async () => {
        store.data = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }));
      });
      await act(async () => {
        for (let i = 0; i < store.data.length; i += 10) {
          store.data[i].label += " !!!";
        }
      });
      const rows = getRows(container);
      expect(rows[0].label).toBe("item 1 !!!");
      expect(rows[1].label).toBe("item 2");
      expect(rows[10].label).toBe("item 11 !!!");
    });

    it("swap rows", async () => {
      setup();
      await act(async () => {
        store.data = Array.from({ length: 1000 }, (_, i) => ({
          id: i + 1,
          label: `item ${i + 1}`,
        }));
      });
      await act(async () => {
        const a = store.data[1];
        const b = store.data[998];
        store.data[1] = b;
        store.data[998] = a;
      });
      const rows = getRows(container);
      expect(rows[1].id).toBe("999");
      expect(rows[998].id).toBe("2");
      expect(rows[0].id).toBe("1");
    });

    it("remove row via splice", async () => {
      setup();
      await act(async () => {
        store.data = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }));
      });
      await act(async () => {
        const idx = store.data.findIndex((d: any) => d.id === 3);
        store.data.splice(idx, 1);
      });
      const rows = getRows(container);
      expect(rows).toHaveLength(9);
      expect(rows[2].id).toBe("4"); // id=3 removed, id=4 shifted up
    });

    it("append rows via push", async () => {
      setup();
      await act(async () => {
        store.data = [{ id: 1, label: "a" }];
      });
      await act(async () => {
        store.data.push({ id: 2, label: "b" }, { id: 3, label: "c" });
      });
      expect(getRows(container)).toHaveLength(3);
    });

    it("clear all rows", async () => {
      setup();
      await act(async () => {
        store.data = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, label: `item ${i + 1}` }));
      });
      expect(getRows(container)).toHaveLength(100);
      await act(async () => {
        store.data = [];
        store.selected = null;
      });
      expect(getRows(container)).toHaveLength(0);
    });
  });

  describe("safe on non-reactive components", () => {
    it("works as memo() when no reactive proxies are read", async () => {
      let renders = 0;
      const Static = tracked(({ text }: { text: string }) => {
        renders++;
        return <div>{text}</div>;
      });

      const { rerender } = render(<Static text="hello" />);
      expect(renders).toBe(1);

      // Same props → memo skips
      rerender(<Static text="hello" />);
      expect(renders).toBe(1);

      // Different props → re-renders
      rerender(<Static text="world" />);
      expect(renders).toBe(2);
    });
  });

  describe("nested tracked components", () => {
    it("parent and child have independent subscriptions", async () => {
      const store = createReactive({ parent: "p", child: "c" });
      let parentRenders = 0;
      let childRenders = 0;

      const Child = tracked(() => {
        childRenders++;
        return <span>{store.child}</span>;
      });

      const Parent = tracked(() => {
        parentRenders++;
        return (
          <div>
            <span>{store.parent}</span>
            <Child />
          </div>
        );
      });

      render(<Parent />);
      const pAfter = parentRenders;
      const cAfter = childRenders;

      // Change only child property
      await act(async () => {
        store.child = "C UPDATED";
      });
      expect(childRenders).toBe(cAfter + 1); // Child re-rendered exactly once
      expect(parentRenders).toBe(pAfter); // Parent did NOT re-render

      // Change only parent property
      const cAfter2 = childRenders;
      await act(async () => {
        store.parent = "P UPDATED";
      });
      expect(parentRenders).toBe(pAfter + 1); // Parent re-rendered exactly once
      expect(childRenders).toBe(cAfter2); // Child did NOT re-render
    });
  });
});
