import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fibonacciBackoff } from "../src/backoff";

describe("property-based fibonacciBackoff tests", () => {
  it("always returns a value within [min, max]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (attempt, a, b) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          if (min === max) return;
          const result = fibonacciBackoff(attempt, min, max);
          expect(result).toBeGreaterThanOrEqual(min);
          expect(result).toBeLessThanOrEqual(max);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns min for attempt <= 0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 0 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 5_001, max: 60_000 }),
        (attempt, min, max) => {
          expect(fibonacciBackoff(attempt, min, max)).toBe(min);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("is non-decreasing as attempt increases", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 5_001, max: 60_000 }),
        (attempt, min, max) => {
          const current = fibonacciBackoff(attempt, min, max);
          const next = fibonacciBackoff(attempt + 1, min, max);
          expect(next).toBeGreaterThanOrEqual(current);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("eventually saturates at max", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 5_001, max: 60_000 }),
        (min, max) => {
          // Attempt 30 produces fib(30)*1000 which far exceeds any reasonable max
          expect(fibonacciBackoff(30, min, max)).toBe(max);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("uses default bounds (1000–60000) when none are provided", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), (attempt) => {
        const result = fibonacciBackoff(attempt);
        expect(result).toBeGreaterThanOrEqual(1000);
        expect(result).toBeLessThanOrEqual(60_000);
      }),
      { numRuns: 100 },
    );
  });
});
