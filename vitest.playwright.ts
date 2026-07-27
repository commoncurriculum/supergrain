import { playwright } from "@vitest/browser-playwright";

// Shared Playwright provider for every browser-mode vitest config.
// CHROMIUM_EXECUTABLE_PATH lets environments with a pre-installed browser
// (e.g. remote CI sandboxes) run the browser suites without downloading
// browsers via `playwright install`. Unset, behavior is identical to
// calling `playwright()` directly.
export function playwrightProvider() {
  return playwright(
    process.env.CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } }
      : undefined,
  );
}
