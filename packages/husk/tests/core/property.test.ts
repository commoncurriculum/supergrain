// =============================================================================
// property.test.ts
// =============================================================================
//
// Property-based tests for `reactiveTask` lifecycle invariants. Generators
// produce arbitrary sequences of run / dispose calls that resolve with random
// values or reject with random errors; assertions pin the envelope contract
// regardless of the order of operations.
//
// These cover invariants the example-driven tests can't easily express:
//
//   - run() resolves with exactly the value the asyncFn returned (when no
//     newer run has superseded it).
//   - The latest-run wins: if run() is called twice, the envelope reflects
//     the SECOND call's outcome regardless of which promise resolves first.
//   - Dispose is terminal: any run() after dispose rejects, never mutates
//     the envelope.
// =============================================================================
import { dispose, reactiveTask } from "@supergrain/husk";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const valueArbitrary = fc.integer({ min: -1000, max: 1000 });
const errorMessageArbitrary = fc.string({ minLength: 1, maxLength: 20 });

describe("reactiveTask — lifecycle invariants", () => {
  it("run().then(...) resolves with exactly the asyncFn return value", async () => {
    await fc.assert(
      fc.asyncProperty(valueArbitrary, async (value) => {
        const task = reactiveTask(async () => value);
        const result = await task.run();
        expect(result).toBe(value);
        expect(task.data).toBe(value);
        expect(task.isResolved).toBe(true);
        expect(task.isRejected).toBe(false);
        expect(task.isSettled).toBe(true);
        expect(task.isReady).toBe(true);
        expect(task.isPending).toBe(false);
        expect(task.error).toBe(null);
        dispose(task);
      }),
      { numRuns: 50 },
    );
  });

  it("run().catch(...) rejects with the asyncFn-thrown error", async () => {
    await fc.assert(
      fc.asyncProperty(errorMessageArbitrary, async (message) => {
        const err = new Error(message);
        const task = reactiveTask(async () => {
          throw err;
        });
        await expect(task.run()).rejects.toBe(err);
        expect(task.error).toBe(err);
        expect(task.isRejected).toBe(true);
        expect(task.isResolved).toBe(false);
        expect(task.isSettled).toBe(true);
        expect(task.isPending).toBe(false);
        expect(task.data).toBe(null);
        dispose(task);
      }),
      { numRuns: 50 },
    );
  });

  it("envelope reflects the latest run when an in-flight run is superseded", async () => {
    await fc.assert(
      fc.asyncProperty(valueArbitrary, valueArbitrary, async (firstValue, secondValue) => {
        // Two pending values keyed to call index. The second call fires
        // BEFORE the first resolves — its outcome must win.
        const deferreds: Array<{ resolve: (v: number) => void; promise: Promise<number> }> = [];
        const task = reactiveTask(async (): Promise<number> => {
          let resolve!: (v: number) => void;
          const promise = new Promise<number>((r) => {
            resolve = r;
          });
          deferreds.push({ resolve, promise });
          return promise;
        });

        const first = task.run();
        const second = task.run();

        // Resolve out of order: second first, then first. The first
        // resolution is from a stale generation and must be ignored.
        deferreds[1]!.resolve(secondValue);
        await second;
        deferreds[0]!.resolve(firstValue);
        await first;

        expect(task.data).toBe(secondValue);
        expect(task.isResolved).toBe(true);
        dispose(task);
      }),
      { numRuns: 30 },
    );
  });

  it("post-dispose run() rejects and does not mutate the envelope", async () => {
    await fc.assert(
      fc.asyncProperty(valueArbitrary, async (value) => {
        const task = reactiveTask(async () => value);
        dispose(task);

        // Read envelope BEFORE the post-dispose run; it must equal the
        // post-run snapshot.
        const before = {
          data: task.data,
          error: task.error,
          isPending: task.isPending,
          isResolved: task.isResolved,
          isRejected: task.isRejected,
          isSettled: task.isSettled,
          isReady: task.isReady,
        };

        await expect(task.run()).rejects.toThrow(/disposed/i);

        const after = {
          data: task.data,
          error: task.error,
          isPending: task.isPending,
          isResolved: task.isResolved,
          isRejected: task.isRejected,
          isSettled: task.isSettled,
          isReady: task.isReady,
        };

        expect(after).toEqual(before);
      }),
      { numRuns: 30 },
    );
  });

  it("isPending is true exactly while a run is in flight", async () => {
    await fc.assert(
      fc.asyncProperty(valueArbitrary, async (value) => {
        let resolveInner!: (v: number) => void;
        const task = reactiveTask(
          async (): Promise<number> =>
            new Promise<number>((r) => {
              resolveInner = r;
            }),
        );

        expect(task.isPending).toBe(false);
        const pending = task.run();
        expect(task.isPending).toBe(true);

        resolveInner(value);
        await pending;

        expect(task.isPending).toBe(false);
        expect(task.data).toBe(value);
        dispose(task);
      }),
      { numRuns: 30 },
    );
  });
});
