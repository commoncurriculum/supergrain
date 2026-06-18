import { render, cleanup, act } from "@testing-library/react";
import React from "react";
/**
 * Krauset benchmark compliance tests.
 *
 * Verifies that all benchmark operations produce correct DOM output
 * matching js-framework-benchmark expectations.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  run,
  add,
  update,
  clear,
  swapRows,
  remove,
  select,
  App,
  buildData,
  resetIdCounter,
} from "./main";

function getRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll("tr")).map((tr) => {
    const tds = tr.querySelectorAll("td");
    return {
      id: tds[0]?.textContent ?? "",
      label: tds[1]?.querySelector("a")?.textContent ?? "",
      className: tr.className,
    };
  });
}

function getTR(container: HTMLElement, n: number) {
  return container.querySelector(`tr:nth-of-type(${n})`);
}

function getTD(container: HTMLElement, row: number, col: number) {
  return container.querySelector(`tr:nth-of-type(${row})>td:nth-of-type(${col})`);
}

describe("krauset compliance: react-supergrain", () => {
  let container: HTMLElement;

  beforeEach(() => {
    clear();
    const result = render(
      <table>
        <tbody data-testid="tbody">
          <App />
        </tbody>
      </table>,
    );
    container = result.container.querySelector("tbody")!;
  });

  afterEach(() => cleanup());

  it("create rows: run(1000) produces 1000 <tr>", async () => {
    await act(async () => {
      run(1000);
    });
    const rows = getRows(container);
    expect(rows).toHaveLength(1000);
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].label).toBeTruthy();
  });

  it("replace all rows: second run(1000) replaces previous rows", async () => {
    await act(async () => {
      run(1000);
    });
    const firstId = getRows(container)[0].id;
    await act(async () => {
      run(1000);
    });
    const rows = getRows(container);
    expect(rows).toHaveLength(1000);
    expect(rows[0].id).not.toBe(firstId);
  });

  it('partial update: update() appends " !!!" to every 10th row', async () => {
    await act(async () => {
      run(1000);
    });
    const labelBefore = getRows(container)[0].label;
    await act(async () => {
      update();
    });
    const rows = getRows(container);
    expect(rows[0].label).toBe(labelBefore + " !!!");
    expect(rows[1].label).not.toContain(" !!!");
    expect(rows[10].label).toContain(" !!!");
  });

  it('select row: select(id) sets class="danger"', async () => {
    await act(async () => {
      run(1000);
    });
    const targetId = Number(getRows(container)[5].id);
    await act(async () => {
      select(targetId);
    });
    const rows = getRows(container);
    expect(rows[5].className).toBe("danger");
    expect(rows[0].className).toBe("");
    expect(rows[6].className).toBe("");
  });

  it("swap rows: swapRows() swaps indices 1 and 998", async () => {
    await act(async () => {
      run(1000);
    });
    const row1Before = getRows(container)[1];
    const row998Before = getRows(container)[998];
    await act(async () => {
      swapRows();
    });
    const rows = getRows(container);
    expect(rows).toHaveLength(1000);
    expect(rows[1].id).toBe(row998Before.id);
    expect(rows[998].id).toBe(row1Before.id);
  });

  it("remove row: remove(id) drops one row", async () => {
    await act(async () => {
      run(1000);
    });
    const targetId = Number(getRows(container)[0].id);
    const secondId = getRows(container)[1].id;
    await act(async () => {
      remove(targetId);
    });
    const rows = getRows(container);
    expect(rows).toHaveLength(999);
    expect(rows[0].id).toBe(secondId);
  });

  it("create many rows: run(10000) produces 10000 <tr>", async () => {
    await act(async () => {
      run(10000);
    });
    expect(getRows(container)).toHaveLength(10000);
  });

  it("append rows: add() appends 1000 to existing 1000", async () => {
    await act(async () => {
      run(1000);
    });
    const lastId = getRows(container)[999].id;
    await act(async () => {
      add();
    });
    const rows = getRows(container);
    expect(rows).toHaveLength(2000);
    expect(rows[999].id).toBe(lastId);
  });

  it("clear rows: clear() removes all <tr>", async () => {
    await act(async () => {
      run(1000);
    });
    expect(getRows(container)).toHaveLength(1000);
    await act(async () => {
      clear();
    });
    expect(getRows(container)).toHaveLength(0);
  });

  // --- isKeyed validation sequence ---
  // Mirrors the exact checks from js-framework-benchmark/webdriver-ts/src/isKeyed.ts

  describe("isKeyed validation (DOM structure)", () => {
    beforeEach(() => {
      resetIdCounter();
    });

    it("TR has correct child element structure", async () => {
      await act(async () => {
        add();
      });
      const tr = getTR(container, 1000)!;
      expect(tr).toBeTruthy();
      const children = Array.from(tr.querySelectorAll(":scope > *"));
      const tags = children.flatMap((el) => {
        const nested = Array.from(el.querySelectorAll("*")).map((c) => c.tagName.toLowerCase());
        return [el.tagName.toLowerCase(), ...nested];
      });
      // isKeyed.ts checkTRcorrect expects: [td, td, a, td, a, span, td]
      expect(tags).toEqual(["td", "td", "a", "td", "a", "span", "td"]);
    });

    it("TDs have correct CSS classes", async () => {
      await act(async () => {
        add();
      });
      const td1 = getTD(container, 1000, 1)!;
      const td2 = getTD(container, 1000, 2)!;
      const td3 = getTD(container, 1000, 3)!;
      const td4 = getTD(container, 1000, 4)!;
      expect(td1.className).toContain("col-md-1");
      expect(td2.className).toContain("col-md-4");
      expect(td3.className).toContain("col-md-1");
      expect(td4.className).toContain("col-md-6");
    });

    it("remove span has aria-hidden='true'", async () => {
      await act(async () => {
        add();
      });
      const span = container.querySelector("tr:nth-of-type(1000)>td:nth-of-type(3)>a>span")!;
      expect(span).toBeTruthy();
      expect(span.getAttribute("aria-hidden")).toBe("true");
      expect(span.className).toContain("glyphicon");
      expect(span.className).toContain("glyphicon-remove");
    });

    it("row 1000 td1 contains '1000' after add()", async () => {
      await act(async () => {
        add();
      });
      const td = getTD(container, 1000, 1)!;
      expect(td.textContent).toBe("1000");
    });
  });

  describe("isKeyed validation (keyed behavior)", () => {
    beforeEach(() => {
      resetIdCounter();
    });

    it("after add + swap, row 2 td1 contains '999'", async () => {
      await act(async () => {
        add();
      });
      await act(async () => {
        swapRows();
      });
      const td = getTD(container, 2, 1)!;
      expect(td.textContent).toBe("999");
    });

    it("after add + swap + run(1000), row 1000 td1 contains '2000'", async () => {
      await act(async () => {
        add();
      });
      await act(async () => {
        swapRows();
      });
      await act(async () => {
        run(1000);
      });
      const td = getTD(container, 1000, 1)!;
      expect(td.textContent).toBe("2000");
    });

    it("after add + swap + run + remove row2, row 2 shifts to next id", async () => {
      await act(async () => {
        add();
      });
      await act(async () => {
        swapRows();
      });
      await act(async () => {
        run(1000);
      });
      // row 2 should be id 1002
      const td2before = getTD(container, 2, 1)!;
      expect(td2before.textContent).toBe("1002");
      const removeId = Number(td2before.textContent);
      await act(async () => {
        remove(removeId);
      });
      // after removing 1002, row 2 should now be 1003
      const td2after = getTD(container, 2, 1)!;
      expect(td2after.textContent).toBe("1003");
    });
  });
});

/**
 * Regression test: push on a fresh store must trigger re-render.
 * Uses a completely fresh createReactive to avoid $NODE leakage from other tests.
 */
describe("fresh store push regression", () => {
  afterEach(() => cleanup());

  it("push on a fresh store triggers re-render without prior assignment", async () => {
    const { createReactive } = await import("@supergrain/kernel");
    const { tracked, For } = await import("@supergrain/kernel/react");

    const freshStore = createReactive<{ data: { id: number; label: string }[] }>({ data: [] });

    const TestApp = tracked(() => {
      return (
        <For each={freshStore.data}>
          {(item: { id: number; label: string }) => (
            <tr key={item.id}>
              <td>{item.label}</td>
            </tr>
          )}
        </For>
      );
    });

    const result = render(
      <table>
        <tbody>
          <TestApp />
        </tbody>
      </table>,
    );
    const tbody = result.container.querySelector("tbody")!;

    await act(async () => {
      freshStore.data.push({ id: 1, label: "one" }, { id: 2, label: "two" });
    });

    expect(tbody.querySelectorAll("tr").length).toBe(2);
  });
});
