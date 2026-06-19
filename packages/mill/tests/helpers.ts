import { unwrap } from "@supergrain/kernel";
import { expect } from "vitest";

import { update, type Query, type UpdateOperations, type UpdateOptions } from "../src";
import { recordUpdate } from "./mongo-oracle";

function snapshot<T extends object>(store: T): Record<string, unknown> {
  // deepUnwrap (not structuredClone) because a $set value can be a reactive
  // proxy that mill stores into the document by reference — structuredClone
  // can't clone a proxy.
  return deepUnwrap(store) as Record<string, unknown>;
}

// Recursively unwrap reactive proxies into plain data, rebuilding plain objects
// and arrays (so the result is decoupled from the live document) while leaving
// Date/RegExp/class instances as-is.
function deepUnwrap(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const raw = unwrap(value);
  if (Array.isArray(raw)) {
    return raw.map(deepUnwrap);
  }
  const proto = Object.getPrototypeOf(raw) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    return raw; // Date/RegExp/class instance — leave untouched
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(raw)) {
    out[key] = deepUnwrap(item);
  }
  return out;
}

// Capture `ops` as plain data at apply time. $set/$push values can be live
// reactive proxies (e.g. reordering by `state.items[1]`) or objects mill aliases
// into the document, so recording the reference would later read post-mutation
// values; deepUnwrap freezes the values exactly as applied.
function captureOps<T extends object>(ops: UpdateOperations<T>): UpdateOperations<T> {
  return deepUnwrap(ops) as UpdateOperations<T>;
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
 * A drop-in for `update()` that also records the forward mutation for the
 * real-mongod oracle. Use this in suites that call `update()` directly (the
 * property fuzzer, positional/undo helpers, kernel-integration) so those
 * mutations get validated against MongoDB too — not just the ones that go
 * through `applyWithUndo`. Undo *applications* (`update(store, {}, undo)`) and
 * throw-tests should keep using the raw `update`.
 */
export function recordedUpdate<T extends object>(
  store: T,
  query: Query<T>,
  ops: UpdateOperations<T>,
  options?: UpdateOptions,
): { doc: T; undo: UpdateOperations<T> } {
  const before = snapshot(store);
  const recordedOps = captureOps(ops);
  const result = update(store, query, ops, options);
  record(before, query, recordedOps, options, snapshot(store));
  return result;
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
  const recordedOps = captureOps(ops);
  const { undo } = update(store, query, ops, options);
  record(before, query, recordedOps, options, snapshot(store));
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
      const recordedOps = captureOps(ops);
      const { undo } = update(store, query, ops, options);
      record(before, query, recordedOps, options, snapshot(store));
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
