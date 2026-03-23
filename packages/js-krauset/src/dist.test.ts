/**
 * Build validation tests.
 *
 * Serves the production build in Playwright and runs the same checks
 * as js-framework-benchmark's isKeyed.ts. If these pass, the build
 * is guaranteed to work in the Krause benchmark.
 *
 * Run: `pnpm test`
 */
import { chromium } from "playwright";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  type TestContext,
  checkDistExists,
  startServer,
  freshPage,
  waitFor,
  click,
  text,
} from "./test-helpers";

const ctx: TestContext = {} as TestContext;

describe("dist validation (isKeyed mirror)", () => {
  beforeAll(async () => {
    checkDistExists();
    const { server, baseUrl } = await startServer();
    ctx.server = server;
    ctx.baseUrl = baseUrl;
    ctx.browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await ctx.browser?.close();
    ctx.server?.close();
  });

  it("page loads and all benchmark buttons exist", async () => {
    const page = await freshPage(ctx);
    for (const id of ["run", "runlots", "add", "update", "clear", "swaprows"]) {
      await waitFor(page, `#${id}`);
    }
    await waitFor(page, "tbody");
  });

  it("add() creates 1000 rows with correct DOM structure", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    expect(await text(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)")).toBe("1000");

    const tags = await page.evaluate(() => {
      const tr = document.querySelector("tbody>tr:nth-of-type(1000)")!;
      return Array.from(tr.querySelectorAll("*")).map((el) => el.tagName.toLowerCase());
    });
    expect(tags).toEqual(["td", "td", "a", "td", "a", "span", "td"]);

    const classes = await page.evaluate(() => {
      const tr = document.querySelector("tbody>tr:nth-of-type(1000)")!;
      return Array.from(tr.querySelectorAll(":scope > td")).map((td) => td.className);
    });
    expect(classes[0]).toContain("col-md-1");
    expect(classes[1]).toContain("col-md-4");
    expect(classes[2]).toContain("col-md-1");
    expect(classes[3]).toContain("col-md-6");

    const span = "tbody>tr:nth-of-type(1000)>td:nth-of-type(3)>a>span";
    expect(await page.getAttribute(span, "aria-hidden")).toBe("true");
    const spanClass = await page.getAttribute(span, "class");
    expect(spanClass).toContain("glyphicon");
    expect(spanClass).toContain("glyphicon-remove");
  });

  it("keyed: swap rows moves DOM nodes", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "#swaprows");
    expect(await text(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("999");
  });

  it("keyed: run replaces all rows", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "#swaprows");
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    expect(await text(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)")).toBe("2000");
  });

  it("keyed: remove deletes the correct row", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "#swaprows");
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    expect(await text(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("1002");
    await click(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(3)>a>span");
    await page.waitForTimeout(500);
    expect(await text(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("1003");
  });

  it("select row highlights with danger class", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    expect(await page.getAttribute("tbody>tr:nth-of-type(5)", "class")).toContain("danger");
    expect(await page.getAttribute("tbody>tr:nth-of-type(4)", "class")).not.toContain("danger");
  });
});
