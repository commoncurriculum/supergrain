import { afterEach, beforeEach, vi } from "vitest";

/**
 * Install paired fake/real timer hooks for the surrounding describe (or
 * file). The afterEach restore is what stops fake-timer state from
 * leaking into the next test in the worker.
 *
 * Use this at file scope or inside a describe — never inside an `it`.
 * For one-off per-test fake timers (`vi.useFakeTimers()` inside a single
 * test body), use `try { ... } finally { vi.useRealTimers() }` instead.
 */
export function setupFakeTimers(): void {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
