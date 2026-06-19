import { unwrap } from "@supergrain/kernel";
import { expect } from "vitest";

import { update, type Query, type UpdateOperations, type UpdateOptions } from "../src";

/**
 * Apply an update to `store`, returning the generated `undo` plus a `rewind()`.
 *
 * The intended shape of a behaviour test:
 *
 *   const { rewind } = applyWithUndo(state, {}, { $set: { a: 10 } });
 *   expect(state.a).toBe(10);   // assert the forward result
 *   rewind();                   // applies undo and asserts state === original
 *
 * `rewind()` applies the undo document and asserts the store deep-equals its
 * exact pre-update state — so every test that mutates also proves its undo.
 */
export function applyWithUndo<T extends object>(
  store: T,
  query: Query<T>,
  ops: UpdateOperations<T>,
  options?: UpdateOptions,
): { undo: UpdateOperations<T>; rewind: () => void } {
  const before = structuredClone(unwrap(store) as object);
  const { undo } = update(store, query, ops, options);
  return {
    undo,
    rewind: () => {
      update(store, {}, undo);
      expect(unwrap(store)).toEqual(before);
    },
  };
}

/**
 * For tests that apply several updates in sequence. Snapshots the store, records
 * each update's `undo`, then `rewindAll()` replays them in reverse and asserts
 * the store is back to its exact starting state.
 *
 *   const rec = undoRecorder(store);
 *   rec.apply({}, { $addToSet: { tags: "c" } });
 *   expect(store.tags).toEqual(["a", "b", "c"]);
 *   rec.rewindAll();  // store back to its initial value
 */
export function undoRecorder<T extends object>(
  store: T,
): {
  apply: (
    query: Query<T>,
    ops: UpdateOperations<T>,
    options?: UpdateOptions,
  ) => UpdateOperations<T>;
  rewindAll: () => void;
} {
  const before = structuredClone(unwrap(store) as object);
  const undos: Array<UpdateOperations<T>> = [];
  return {
    apply: (query, ops, options) => {
      const { undo } = update(store, query, ops, options);
      undos.push(undo);
      return undo;
    },
    rewindAll: () => {
      for (let i = undos.length - 1; i >= 0; i--) {
        update(store, {}, undos[i]!);
      }
      expect(unwrap(store)).toEqual(before);
    },
  };
}
