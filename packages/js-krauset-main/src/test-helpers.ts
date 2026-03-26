import { existsSync, readFileSync } from "fs";
import { createServer, type Server } from "http";
import { resolve, extname } from "path";
import { chromium, type Browser, type Page } from "playwright";

const distDir = resolve(__dirname, "../dist");
const cssDir = resolve(__dirname, "../css");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
};

export interface TestContext {
  server: Server;
  browser: Browser;
  page: Page;
  baseUrl: string;
}

export function checkDistExists() {
  if (!existsSync(resolve(distDir, "assets/index.js"))) {
    throw new Error("dist/assets/index.js not found. Run `pnpm build-prod` first.");
  }
  if (!existsSync(resolve(distDir, "index.html"))) {
    throw new Error("dist/index.html not found. Run `pnpm build-prod` first.");
  }
}

export async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const urlPath = (req.url ?? "/").replace(/^\//, "") || "index.html";
    // Serve /css/* from the css directory, everything else from dist
    const filePath = urlPath.startsWith("css/")
      ? resolve(cssDir, urlPath.slice(4))
      : resolve(distDir, urlPath);
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
  return { server, baseUrl: `http://localhost:${address.port}` };
}

export async function freshPage(ctx: TestContext): Promise<Page> {
  if (ctx.page) await ctx.page.close();
  ctx.page = await ctx.browser.newPage();
  await ctx.page.goto(`${ctx.baseUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await ctx.page.waitForTimeout(500);
  return ctx.page;
}

export async function waitFor(page: Page, selector: string, timeout = 5000) {
  await page.waitForSelector(selector, { state: "attached", timeout });
}

export async function click(page: Page, selector: string) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.click();
  }, selector);
  await page.waitForTimeout(100);
}

export async function text(page: Page, selector: string): Promise<string | null> {
  return page.textContent(selector);
}
