import { unwrap } from "@supergrain/kernel";
import { expect } from "vitest";

import { update, type Query, type UpdateOperations, type UpdateOptions } from "../src";
import { recordUpdate } from "./mongo-oracle";

function snapshot<T extends object>(store: T): Record<string, unknown> {
  return structuredClone(unwrap(store)) as Record<string, unknown>;
}

// Record the update mill just performed so the global `afterEach` can replay it
// against real mongod and confirm mill matched MongoDB exactly.
function record<T extends object>(
  before: Record<string, unknown>,
  query: Query<T>,
  ops: UpdateOperations<T>,
  options: UpdateOptions | undefined,
  after: Record<string, unknown>,
): void {
  recordUpdate({
    before,
    query: (query ?? {}) as Record<string, unknown>,
    ops: ops as Record<string, unknown>,
    options: options as Record<string, unknown> | undefined,
    after,
  });
}

/**
 * Apply an update to `store`, returning the generated `undo` plus a `rewindAndAssertRestored()`.
 *
 * The intended shape of a behaviour test:
 *
 *   const { rewindAndAssertRestored } = applyWithUndo(state, {}, { $set: { a: 10 } });
 *   expect(state.a).toBe(10);   // assert the forward result
 *   rewindAndAssertRestored();                   // applies undo and asserts state === original
 *
 * `rewindAndAssertRestored()` applies the undo document and asserts the store deep-equals its
 * exact pre-update state — so every test that mutates also proves its undo.
 */
export function applyWithUndo<T extends object>(
  store: T,
  query: Query<T>,
  ops: UpdateOperations<T>,
  options?: UpdateOptions,
): { undo: UpdateOperations<T>; rewindAndAssertRestored: () => void } {
  const before = snapshot(store);
  const { undo } = update(store, query, ops, options);
  record(before, query, ops, options, snapshot(store));
  return {
    undo,
    rewindAndAssertRestored: () => {
      update(store, {}, undo);
      expect(unwrap(store)).toEqual(before);
    },
  };
}

/**
 * For tests that apply several updates in sequence. Snapshots the store, records
 * each update's `undo`, then `rewindAndAssertRestored()` replays them in reverse and asserts
 * the store is back to its exact starting state.
 *
 *   const rec = undoRecorder(store);
 *   rec.apply({}, { $addToSet: { tags: "c" } });
 *   expect(store.tags).toEqual(["a", "b", "c"]);
 *   rec.rewindAndAssertRestored();  // store back to its initial value
 */
export function undoRecorder<T extends object>(
  store: T,
): {
  apply: (
    query: Query<T>,
    ops: UpdateOperations<T>,
    options?: UpdateOptions,
  ) => UpdateOperations<T>;
  rewindAndAssertRestored: () => void;
} {
  const initial = snapshot(store);
  const undos: Array<UpdateOperations<T>> = [];
  return {
    apply: (query, ops, options) => {
      const before = snapshot(store);
      const { undo } = update(store, query, ops, options);
      record(before, query, ops, options, snapshot(store));
      undos.push(undo);
      return undo;
    },
    rewindAndAssertRestored: () => {
      for (let i = undos.length - 1; i >= 0; i--) {
        update(store, {}, undos[i]!);
      }
      expect(unwrap(store)).toEqual(initial);
    },
  };
}
