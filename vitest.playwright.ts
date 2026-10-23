import { playwright } from "@vitest/browser-playwright";

// Shared Playwright provider for every browser-mode vitest config.
// CHROMIUM_EXECUTABLE_PATH makes the browser suites *launch* a pre-installed
// browser (e.g. in remote CI sandboxes) instead of Playwright's managed one.
// It does not stop `pnpm install` from downloading browsers — Playwright's
// postinstall does that independently (suppress with
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 if the environment provides its own
// browser). Unset, behavior is identical to calling `playwright()` directly.
export function playwrightProvider() {
  return playwright(
    process.env.CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } }
      : undefined,
  );
}
