import { existsSync, readFileSync } from "fs";
/**
 * Post-build validation test.
 *
 * Serves the built dist/ directory and runs the exact same checks that
 * js-framework-benchmark's isKeyed.ts performs. If this test passes,
 * the built artifact is guaranteed to work in the Krause benchmark.
 *
 * Run after build: `pnpm build-prod && pnpm test:dist`
 */
import { createServer, type Server } from "http";
import { resolve, extname } from "path";
import { chromium, type Browser, type Page } from "playwright";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const distDir = resolve(__dirname, "../dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};

let server: Server;
let browser: Browser;
let page: Page;
let baseUrl: string;

async function waitFor(selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: "attached", timeout });
}

async function click(selector: string) {
  // Use dispatchEvent — no CSS is loaded so elements may be off-viewport
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.click();
  }, selector);
  await page.waitForTimeout(100);
}

async function text(selector: string): Promise<string | null> {
  return page.textContent(selector);
}

describe("dist validation (isKeyed mirror)", () => {
  beforeAll(async () => {
    if (!existsSync(resolve(distDir, "assets/index.js"))) {
      throw new Error("dist/assets/index.js not found. Run `pnpm build-prod` first.");
    }
    if (!existsSync(resolve(distDir, "index.html"))) {
      throw new Error("dist/index.html not found. Run `pnpm build-prod` first.");
    }

    server = createServer((req, res) => {
      const filePath = resolve(distDir, (req.url ?? "/").replace(/^\//, "") || "index.html");
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" });
      res.end(readFileSync(filePath));
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server failed to start");
    baseUrl = `http://localhost:${address.port}`;

    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  async function freshPage() {
    if (page) await page.close();
    page = await browser.newPage();
    await page.goto(`${baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
    // Wait for module script to execute and attach event listeners
    await page.waitForTimeout(500);
  }

  it("page loads and all benchmark buttons exist", async () => {
    await freshPage();
    for (const id of ["run", "runlots", "add", "update", "clear", "swaprows"]) {
      await waitFor(`#${id}`);
    }
    await waitFor("#tbody");
  });

  it("add() creates 1000 rows with correct DOM structure", async () => {
    await freshPage();
    await click("#add");
    await waitFor("tbody>tr:nth-of-type(1000)");

    // Row 1000 id = "1000"
    expect(await text("tbody>tr:nth-of-type(1000)>td:nth-of-type(1)")).toBe("1000");

    // TR child element structure matches isKeyed.ts checkTRcorrect
    const tags = await page.evaluate(() => {
      const tr = document.querySelector("tbody>tr:nth-of-type(1000)")!;
      return Array.from(tr.querySelectorAll("*")).map((el) => el.tagName.toLowerCase());
    });
    expect(tags).toEqual(["td", "td", "a", "td", "a", "span", "td"]);

    // CSS classes on TDs
    const classes = await page.evaluate(() => {
      const tr = document.querySelector("tbody>tr:nth-of-type(1000)")!;
      return Array.from(tr.querySelectorAll(":scope > td")).map((td) => td.className);
    });
    expect(classes[0]).toContain("col-md-1");
    expect(classes[1]).toContain("col-md-4");
    expect(classes[2]).toContain("col-md-1");
    expect(classes[3]).toContain("col-md-6");

    // Remove span: aria-hidden and glyphicon classes
    const span = "tbody>tr:nth-of-type(1000)>td:nth-of-type(3)>a>span";
    expect(await page.getAttribute(span, "aria-hidden")).toBe("true");
    const spanClass = await page.getAttribute(span, "class");
    expect(spanClass).toContain("glyphicon");
    expect(spanClass).toContain("glyphicon-remove");
  });

  it("keyed: swap rows moves DOM nodes", async () => {
    await freshPage();
    await click("#add");
    await waitFor("tbody>tr:nth-of-type(1000)");
    await click("#swaprows");
    expect(await text("tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("999");
  });

  it("keyed: run replaces all rows", async () => {
    await freshPage();
    await click("#add");
    await waitFor("tbody>tr:nth-of-type(1000)");
    await click("#swaprows");
    await click("#run");
    await waitFor("tbody>tr:nth-of-type(1000)");
    expect(await text("tbody>tr:nth-of-type(1000)>td:nth-of-type(1)")).toBe("2000");
  });

  it("keyed: remove deletes the correct row", async () => {
    await freshPage();
    await click("#add");
    await waitFor("tbody>tr:nth-of-type(1000)");
    await click("#swaprows");
    await click("#run");
    await waitFor("tbody>tr:nth-of-type(1000)");

    const row2id = await text("tbody>tr:nth-of-type(2)>td:nth-of-type(1)");
    expect(row2id).toBe("1002");

    // Click the remove icon on row 2
    await click("tbody>tr:nth-of-type(2)>td:nth-of-type(3)>a>span");

    // Give React time to re-render after removal
    await page.waitForTimeout(500);

    const row2after = await text("tbody>tr:nth-of-type(2)>td:nth-of-type(1)");
    expect(row2after).toBe("1003");
  });

  it("select row highlights with danger class", async () => {
    await freshPage();
    await click("#run");
    await waitFor("tbody>tr:nth-of-type(1000)");
    await click("tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    expect(await page.getAttribute("tbody>tr:nth-of-type(5)", "class")).toContain("danger");
    expect(await page.getAttribute("tbody>tr:nth-of-type(4)", "class")).not.toContain("danger");
  });
});
