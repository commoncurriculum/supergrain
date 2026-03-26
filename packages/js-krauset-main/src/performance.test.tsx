import { render, cleanup, act } from "@testing-library/react";
import React from "react";
/**
 * Krauset performance tests — react-supergrain (For + React).
 *
 * Times each benchmark operation and reports ms.
 * These are NOT strict assertions — they report numbers for comparison.
 */
import { describe, it, expect, afterEach } from "vitest";

import { run, add, update, clear, swapRows, remove, select, App } from "./main";

function getRowCount(container: HTMLElement) {
  return container.querySelectorAll("tr").length;
}

async function timeOp(fn: () => void): Promise<number> {
  const start = performance.now();
  await act(async () => {
    fn();
  });
  return performance.now() - start;
}

describe("krauset perf: react-supergrain", () => {
  let container: HTMLElement;

  afterEach(() => {
    clear();
    cleanup();
  });

  function mount() {
    const result = render(
      <table>
        <tbody data-testid="tbody">
          <App />
        </tbody>
      </table>,
    );
    container = result.container.querySelector("tbody")!;
  }

  it("create rows (1000)", async () => {
    mount();
    const ms = await timeOp(() => run(1000));
    expect(getRowCount(container)).toBe(1000);
    console.log(`create rows: ${ms.toFixed(1)}ms`);
  });

  it("replace all rows", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const ms = await timeOp(() => run(1000));
    expect(getRowCount(container)).toBe(1000);
    console.log(`replace all rows: ${ms.toFixed(1)}ms`);
  });

  it("partial update (every 10th)", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const ms = await timeOp(() => update());
    console.log(`partial update: ${ms.toFixed(1)}ms`);
  });

  it("select row", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const firstId = Number(container.querySelector("tr td")!.textContent);
    const ms = await timeOp(() => select(firstId));
    console.log(`select row: ${ms.toFixed(1)}ms`);
  });

  it("swap rows", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const ms = await timeOp(() => swapRows());
    console.log(`swap rows: ${ms.toFixed(1)}ms`);
  });

  it("remove row", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const firstId = Number(container.querySelector("tr td")!.textContent);
    const ms = await timeOp(() => remove(firstId));
    expect(getRowCount(container)).toBe(999);
    console.log(`remove row: ${ms.toFixed(1)}ms`);
  });

  it("create many rows (10000)", async () => {
    mount();
    const ms = await timeOp(() => run(10000));
    expect(getRowCount(container)).toBe(10000);
    console.log(`create many rows: ${ms.toFixed(1)}ms`);
  });

  it("append rows (1000 to 1000)", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const ms = await timeOp(() => add());
    expect(getRowCount(container)).toBe(2000);
    console.log(`append rows: ${ms.toFixed(1)}ms`);
  });

  it("clear rows", async () => {
    mount();
    await act(async () => {
      run(1000);
    });
    const ms = await timeOp(() => clear());
    expect(getRowCount(container)).toBe(0);
    console.log(`clear rows: ${ms.toFixed(1)}ms`);
  });
});
