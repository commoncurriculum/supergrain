import { render, cleanup, act } from "@testing-library/react";
import React from "react";
/**
 * Krauset performance tests — react-supergrain (For + React).
 *
 * Mirrors the exact setup from js-framework-benchmark/webdriver-ts/src/benchmarksPlaywright.ts:
 * - Mount matches real benchmark: App renders full page into a container
 * - Operations triggered via DOM clicks (not direct store calls)
 * - Warmup counts match Krause benchmarkInfo
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";

import { App, resetIdCounter } from "./main";

function getRowCount(root: HTMLElement) {
  return root.querySelectorAll("tbody > tr").length;
}

function getRowText(root: HTMLElement, rowIndex: number, colIndex: number): string | null {
  return (
    root.querySelector(`tbody > tr:nth-of-type(${rowIndex}) > td:nth-of-type(${colIndex})`)
      ?.textContent ?? null
  );
}

function click(root: HTMLElement, selector: string) {
  const el = root.querySelector(selector) as HTMLElement;
  if (!el) throw new Error(`Element not found: ${selector}`);
  el.click();
}

async function clickAndWait(root: HTMLElement, selector: string) {
  await act(async () => {
    click(root, selector);
  });
}

async function timeClick(root: HTMLElement, selector: string): Promise<number> {
  const start = performance.now();
  await act(async () => {
    click(root, selector);
  });
  return performance.now() - start;
}

const results: { name: string; ms: number }[] = [];

describe("krauset perf: react-supergrain", () => {
  let root: HTMLElement;

  afterEach(() => {
    resetIdCounter();
    cleanup();
  });

  afterAll(() => {
    const lines = results.map((r) => `${r.name.padEnd(30)} ${r.ms.toFixed(1).padStart(8)}ms`);
    console.log(`\nBenchmark Results\n${"─".repeat(42)}\n${lines.join("\n")}\n${"─".repeat(42)}`);
  });

  function mount() {
    const result = render(<App />);
    root = result.container;
  }

  // 01_run1k: 5 warmup run+clear cycles, then time run
  it("create rows (1000)", async () => {
    mount();
    for (let i = 0; i < 5; i++) {
      await clickAndWait(root, "#run");
      await clickAndWait(root, "#clear");
    }
    const ms = await timeClick(root, "#run");
    expect(getRowCount(root)).toBe(1000);
    results.push({ name: "create rows (1k)", ms });
  });

  // 02_replace1k: 5 warmup runs (no clears), then time run
  it("replace all rows", async () => {
    mount();
    for (let i = 0; i < 5; i++) {
      await clickAndWait(root, "#run");
    }
    const ms = await timeClick(root, "#run");
    expect(getRowCount(root)).toBe(1000);
    results.push({ name: "replace all rows", ms });
  });

  // 03_update10th: run(1000), 3 warmup updates, then time 4th update
  it("partial update (every 10th)", async () => {
    mount();
    await clickAndWait(root, "#run");
    for (let i = 0; i < 3; i++) {
      await clickAndWait(root, "#update");
    }
    const ms = await timeClick(root, "#update");
    expect(getRowText(root, 1, 2)).toContain(" !!!");
    results.push({ name: "partial update (10th)", ms });
  });

  // 04_select1k: run(1000), select row 5 (warmup), then time select row 2
  it("select row", async () => {
    mount();
    await clickAndWait(root, "#run");
    // Warmup: click row 5's label
    await clickAndWait(root, "tbody > tr:nth-of-type(5) > td:nth-of-type(2) > a");
    expect(root.querySelector("tbody > tr:nth-of-type(5)")?.className).toContain("danger");
    // Timed: click row 2's label
    const ms = await timeClick(root, "tbody > tr:nth-of-type(2) > td:nth-of-type(2) > a");
    expect(root.querySelector("tbody > tr:nth-of-type(2)")?.className).toContain("danger");
    expect(root.querySelector("tbody > tr:nth-of-type(5)")?.className).not.toContain("danger");
    results.push({ name: "select row", ms });
  });

  // 05_swap1k: run(1000), 6 warmup swaps, then time 7th swap
  it("swap rows", async () => {
    mount();
    await clickAndWait(root, "#run");
    for (let i = 0; i < 6; i++) {
      await clickAndWait(root, "#swaprows");
    }
    // After 6 swaps (even number), rows are back in original position
    expect(getRowText(root, 2, 1)).toBe("2");
    expect(getRowText(root, 999, 1)).toBe("999");
    const ms = await timeClick(root, "#swaprows");
    expect(getRowText(root, 2, 1)).toBe("999");
    expect(getRowText(root, 999, 1)).toBe("2");
    results.push({ name: "swap rows", ms });
  });

  // 06_remove: run(1000), 5 warmup removes from row 5+ area, then time remove from row 4
  it("remove row", async () => {
    mount();
    await clickAndWait(root, "#run");
    for (let i = 0; i < 5; i++) {
      const rowToClick = 5 - i + 4; // matches Krause: warmupCount - i + rowsToSkip
      await clickAndWait(
        root,
        `tbody > tr:nth-of-type(${rowToClick}) > td:nth-of-type(3) > a > span`,
      );
    }
    const ms = await timeClick(root, "tbody > tr:nth-of-type(4) > td:nth-of-type(3) > a > span");
    expect(getRowCount(root)).toBe(994);
    results.push({ name: "remove row", ms });
  });

  // 07_create10k: 5 warmup run+clear cycles, then time runlots
  it("create many rows (10000)", async () => {
    mount();
    for (let i = 0; i < 5; i++) {
      await clickAndWait(root, "#run");
      await clickAndWait(root, "#clear");
    }
    const ms = await timeClick(root, "#runlots");
    expect(getRowCount(root)).toBe(10000);
    results.push({ name: "create many rows (10k)", ms });
  });

  // 08_append: 5 warmup run+clear cycles, then run(1000), then time add
  it("append rows (1000 to 1000)", async () => {
    mount();
    for (let i = 0; i < 5; i++) {
      await clickAndWait(root, "#run");
      await clickAndWait(root, "#clear");
    }
    await clickAndWait(root, "#run");
    const ms = await timeClick(root, "#add");
    expect(getRowCount(root)).toBe(2000);
    results.push({ name: "append rows (1k to 1k)", ms });
  });

  // 09_clear: 5 warmup run+clear cycles, then run(1000), then time clear
  it("clear rows", async () => {
    mount();
    for (let i = 0; i < 5; i++) {
      await clickAndWait(root, "#run");
      await clickAndWait(root, "#clear");
    }
    await clickAndWait(root, "#run");
    const ms = await timeClick(root, "#clear");
    expect(getRowCount(root)).toBe(0);
    results.push({ name: "clear rows", ms });
  });
});
