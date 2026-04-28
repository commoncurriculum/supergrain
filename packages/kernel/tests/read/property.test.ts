// =============================================================================
// property.test.ts
// =============================================================================
//
// Property-based tests for the kernel READ path. Pins invariants that
// example-driven tests can't easily cover across permutations:
//
//   - Transparency: `unwrap(state)` after any sequence of writes deep-equals
//     a plain object that received the same writes — the proxy doesn't drop
//     or rewrite values.
//   - Identity stability: re-reading an unchanged property returns the same
//     proxy instance — caching survives unrelated writes.
//   - Setter `===` check: writing the SAME value as the current one does
//     not trigger any subscriber re-run.
//   - Subscription locality: an effect reading only `state.a` does not
//     re-run when only `state.b` or `state.c` is written.
// =============================================================================
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createReactive, effect, unwrap } from "../../src";

interface ScalarState {
  a: number;
  b: number;
  c: number;
  text: string;
}

type ScalarOp =
  | { kind: "setA"; value: number }
  | { kind: "setB"; value: number }
  | { kind: "setC"; value: number }
  | { kind: "setText"; value: string };

const intArbitrary = fc.integer({ min: -50, max: 50 });
const stringArbitrary = fc.string({ minLength: 0, maxLength: 8 });

const scalarOpArbitrary: fc.Arbitrary<ScalarOp> = fc.oneof(
  fc.record({ kind: fc.constant<"setA">("setA"), value: intArbitrary }),
  fc.record({ kind: fc.constant<"setB">("setB"), value: intArbitrary }),
  fc.record({ kind: fc.constant<"setC">("setC"), value: intArbitrary }),
  fc.record({ kind: fc.constant<"setText">("setText"), value: stringArbitrary }),
);

function applyScalarOp<T extends ScalarState>(target: T, op: ScalarOp): void {
  switch (op.kind) {
    case "setA":
      target.a = op.value;
      return;
    case "setB":
      target.b = op.value;
      return;
    case "setC":
      target.c = op.value;
      return;
    case "setText":
      target.text = op.value;
      return;
  }
}

describe("kernel read — transparency", () => {
  it("`unwrap(reactive)` after any write sequence deep-equals plain-object replay", () => {
    fc.assert(
      fc.property(fc.array(scalarOpArbitrary, { minLength: 1, maxLength: 30 }), (ops) => {
        const seed: ScalarState = { a: 0, b: 0, c: 0, text: "" };
        const reactive = createReactive<ScalarState>(structuredClone(seed));
        const plain: ScalarState = structuredClone(seed);

        for (const op of ops) {
          applyScalarOp(reactive, op);
          applyScalarOp(plain, op);
        }

        expect(unwrap(reactive)).toEqual(plain);
      }),
      { numRuns: 100 },
    );
  });
});

describe("kernel read — setter `===` short-circuit", () => {
  it("writing a value that equals the current one fires NO subscribers", () => {
    fc.assert(
      fc.property(intArbitrary, (initial) => {
        const state = createReactive({ a: initial });
        let runs = 0;
        const stop = effect(() => {
          void state.a;
          runs++;
        });

        const initialRuns = runs;
        // Same-value writes — must not trigger re-runs.
        state.a = initial;
        state.a = initial;
        state.a = initial;

        expect(runs).toBe(initialRuns);
        stop();
      }),
      { numRuns: 100 },
    );
  });

  it("writing a different value DOES fire subscribers", () => {
    fc.assert(
      fc.property(intArbitrary, intArbitrary, (initial, next) => {
        fc.pre(initial !== next);
        const state = createReactive({ a: initial });
        let runs = 0;
        const stop = effect(() => {
          void state.a;
          runs++;
        });

        const initialRuns = runs;
        state.a = next;

        expect(runs).toBeGreaterThan(initialRuns);
        stop();
      }),
      { numRuns: 100 },
    );
  });
});

describe("kernel read — subscription locality", () => {
  it("an effect reading only state.a does NOT re-run when state.b or state.c is written", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.record({ kind: fc.constant<"setB">("setB"), value: intArbitrary }),
            fc.record({ kind: fc.constant<"setC">("setC"), value: intArbitrary }),
          ),
          { minLength: 1, maxLength: 20 },
        ),
        (ops) => {
          const state = createReactive<ScalarState>({ a: 0, b: 0, c: 0, text: "" });
          let runs = 0;
          const stop = effect(() => {
            void state.a;
            runs++;
          });

          const initialRuns = runs;
          for (const op of ops) {
            applyScalarOp(state as ScalarState, op as ScalarOp);
          }

          expect(runs).toBe(initialRuns);
          stop();
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("kernel read — identity stability for unchanged sub-objects", () => {
  it("re-reading an unchanged sub-object returns the same proxy instance", () => {
    fc.assert(
      fc.property(intArbitrary, (b) => {
        const state = createReactive({ child: { x: 1 }, sibling: { y: 0 } });

        const childBefore = state.child;
        // Mutate an UNRELATED sibling property.
        state.sibling.y = b;

        const childAfter = state.child;
        // Identity must be stable — the proxy cache must return the same
        // wrapper, otherwise consumers using `===` on tracked references
        // see spurious "changes" they didn't cause.
        expect(childBefore).toBe(childAfter);
      }),
      { numRuns: 50 },
    );
  });
});
