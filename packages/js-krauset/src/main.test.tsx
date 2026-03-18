import { render, cleanup, act } from "@testing-library/react";
import React from "react";
/**
 * Krauset benchmark compliance tests.
 *
 * Verifies that all benchmark operations produce correct DOM output
 * matching js-framework-benchmark expectations.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { run, add, update, clear, swapRows, remove, select, App, buildData } from "./main";

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
});
