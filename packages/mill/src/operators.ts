import { batch, unwrap } from "@supergrain/kernel";

import { $addToSet } from "./operators/add-to-set";
import { $inc } from "./operators/inc";
import { $max } from "./operators/max";
import { $min } from "./operators/min";
import { $mul } from "./operators/mul";
import { $pop } from "./operators/pop";
import { $pull } from "./operators/pull";
import { $pullAll } from "./operators/pull-all";
import { $push } from "./operators/push";
import { $rename } from "./operators/rename";
import { $set } from "./operators/set";
import { type OperatorContext } from "./operators/shared";
import { $unset } from "./operators/unset";
import {
  type ArrayPopOperations,
  type ArrayPullAllOperations,
  type ArrayPullOperations,
  type ArrayPushOperations,
  type ArrayWriteOperations,
  type NumericPathOperations,
  type SetPathOperations,
  type UnsetPathOperations,
} from "./path";
import { type ArrayFilter, arrayFilterIdentifier, type Query } from "./query";
import { type MutableUndo } from "./undo";

/**
 * MongoDB-style update engine for in-memory documents.
 *
 * `update(doc, query, operations, options)` applies a standard Mongo update
 * document to `doc`, in place, and returns both the (same) document reference
 * and an `undo` — itself a standard Mongo update document — that reverses the
 * exact changes made. There is no mill-specific syntax.
 *
 * The implementation is split by concern: `undo.ts` (inverse accumulation),
 * `array-ops.ts` (in-place array primitives), `query.ts` (positional resolution
 * + matching), `path.ts` (path navigation + typing), and one file per operator
 * under `operators/` over a small shared `operators/shared.ts`. This module just
 * wires them into the dispatch table and the public `update()` entry point.
 */

// Forward-application order. Mongo forbids two operators touching the same path
// in one update, so across operators every path is disjoint and this order only
// has to be internally consistent.
const operatorList = [
  "$set",
  "$unset",
  "$rename",
  "$mul",
  "$inc",
  "$min",
  "$max",
  "$pop",
  "$pull",
  "$pullAll",
  "$push",
  "$addToSet",
] as const;

const operators: Record<string, (context: OperatorContext, operations: any) => void> = {
  $set,
  $unset,
  $rename,
  $mul,
  $inc,
  $min,
  $max,
  $pop,
  $pull,
  $pullAll,
  $push,
  $addToSet,
};

// ─── public types ───────────────────────────────────────────────────────────

/**
 * Strict, type-aware update operations for a target shape `T`.
 *
 * Each operator's value type is derived from `T`:
 *   - `$set` / `$unset` accept any path within `T` (see `Path<T>`), including
 *     positional `cards.$.title` / `cards.$[].title` forms.
 *   - `$inc` / `$mul` / `$min` / `$max` accept numeric paths only.
 *   - `$push` / `$pop` / `$pull` / `$pullAll` / `$addToSet` accept array paths.
 *
 * Per-path value typing is enforced: `$set: { "user.name": 42 }` is rejected
 * when `user.name` is typed as `string`.
 */
export type StrictUpdateOperations<T extends object> = Partial<{
  $set: SetPathOperations<T>;
  $unset: UnsetPathOperations<T>;
  $rename: Record<string, string>;
  $inc: NumericPathOperations<T>;
  $mul: NumericPathOperations<T>;
  $min: NumericPathOperations<T>;
  $max: NumericPathOperations<T>;
  $push: ArrayPushOperations<T>;
  $pop: ArrayPopOperations<T>;
  $pull: ArrayPullOperations<T>;
  $pullAll: ArrayPullAllOperations<T>;
  $addToSet: ArrayWriteOperations<T>;
}>;

/**
 * Default operations type for `update()`.
 *
 * Strict — callers must supply paths that match `Path<T>` and values that
 * match `PathValue<T, P>` per path.
 */
export type UpdateOperations<T extends object = Record<string, any>> = StrictUpdateOperations<T>;

/**
 * The result of an `update()` call: the same `doc` reference back, plus an
 * `undo` — a standard Mongo update document that, applied to the post-update
 * `doc`, reverses the exact changes that were made.
 */
export interface UpdateResult<T extends object> {
  doc: T;
  undo: UpdateOperations<T>;
}

/**
 * Options for `update()`. Mirrors the MongoDB driver's update options object.
 */
export interface UpdateOptions {
  /**
   * Filter documents for the `$[<identifier>]` filtered positional operator —
   * each targets one identifier and an element qualifies when its conditions
   * match. Every `$[<identifier>]` in the update needs a matching filter, and
   * every supplied filter must be used.
   */
  arrayFilters?: Array<ArrayFilter>;

  /**
   * Treat a `null` intermediate or target as if the field were *absent* rather
   * than rejecting it. This is a deliberate **departure from MongoDB**, which
   * throws in these cases (`Cannot create field 'b' in element {a: null}`, or
   * `The field 'a' must be an array but is of type null`). When enabled:
   *
   *   - `$set` / `$inc` / `$mul` / `$min` / `$max` / `$rename` build objects
   *     over `null` intermediates instead of throwing.
   *   - `$push` / `$addToSet` create the array when the target (or an
   *     intermediate) is `null`.
   *   - `$pull` / `$pullAll` / `$pop` no-op on a `null` target (exactly as they
   *     already do for a missing field).
   *
   * The generated `undo` restores the prior `null` exactly. Off by default so
   * mill stays faithful to MongoDB.
   */
  allowNullIntermediates?: boolean;
}

// Collect the `$[<identifier>]` identifiers referenced in an update document's
// paths, so we can flag supplied arrayFilters that go unused. Only path keys are
// scanned — Mongo's positional operators aren't valid in `$rename` values, and
// every operator's payload is a path-keyed object.
function referencedArrayFilterIdentifiers(operations: UpdateOperations<any>): Set<string> {
  const used = new Set<string>();
  for (const payload of Object.values(operations)) {
    for (const key of Object.keys(payload as Record<string, unknown>)) {
      for (const segment of key.split(".")) {
        if (segment.startsWith("$[") && segment.endsWith("]") && segment.length > 3) {
          used.add(segment.slice(2, -1));
        }
      }
    }
  }
  return used;
}

// Two update paths conflict when they're equal or one is a prefix of the other
// (compared segment by segment) — MongoDB rejects such an update rather than
// applying both. e.g. "a" conflicts with "a" and "a.b"; "a.b" and "a.c" don't.
function pathsConflict(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  const aSegments = a.split(".");
  const bSegments = b.split(".");
  const shared = Math.min(aSegments.length, bSegments.length);
  for (let i = 0; i < shared; i++) {
    if (aSegments[i] !== bSegments[i]) {
      return false;
    }
  }
  return true; // one path is a prefix of the other
}

// Reject an update whose operators (or keys) write the same path, or a
// parent/child of it — the conflict MongoDB refuses. $rename also occupies its
// destination path, so that is checked too.
function assertNoPathConflicts(operations: UpdateOperations<any>): void {
  const paths: Array<string> = [];
  for (const [operator, payload] of Object.entries(operations)) {
    for (const key of Object.keys(payload as Record<string, unknown>)) {
      paths.push(key);
      // $rename also writes its destination path. A same-field rename
      // (`{ a: "a" }`) is left to $rename's own "must differ" check.
      if (operator === "$rename") {
        const destination = (payload as Record<string, string>)[key]!;
        if (destination !== key) {
          paths.push(destination);
        }
      }
    }
  }
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (pathsConflict(paths[i]!, paths[j]!)) {
        throw new Error(
          `Update would create a conflict between paths "${paths[i]}" and "${paths[j]}".`,
        );
      }
    }
  }
}

/**
 * Apply a MongoDB update document to `doc` in place.
 *
 * @param doc        The document to mutate (a reactive store or a plain object).
 *                   The same reference is returned in `result.doc`.
 * @param query      A Mongo query used only to resolve positional paths
 *                   (`items.$.name`). Pass `{}` when the update has none.
 * @param operations A standard Mongo update document.
 * @param options    Optional update options — `arrayFilters` for the
 *                   `$[<identifier>]` filtered positional operator, and
 *                   `allowNullIntermediates` to treat `null` intermediates as
 *                   absent (a deliberate departure from MongoDB).
 * @returns          `{ doc, undo }` — `undo` reverses the actual changes made.
 */
export function update<T extends object>(
  doc: T,
  query: Query<T>,
  operations: UpdateOperations<T>,
  options?: UpdateOptions,
): UpdateResult<T> {
  const raw = unwrap(doc) as object;
  const undo: MutableUndo = {};
  const arrayFilters = options?.arrayFilters ?? [];

  assertNoPathConflicts(operations);

  // When arrayFilters are supplied, enforce Mongo's two consistency rules (in
  // its order): every referenced identifier must have a filter, then every
  // supplied filter must be used. When none are supplied, a stray `$[id]` is
  // still caught at resolution time, so the common path pays nothing here.
  if (arrayFilters.length > 0) {
    const referenced = referencedArrayFilterIdentifiers(operations);
    const provided = new Set(arrayFilters.map(arrayFilterIdentifier));
    for (const identifier of referenced) {
      if (!provided.has(identifier)) {
        throw new Error(`No array filter found for identifier "${identifier}".`);
      }
    }
    for (const filter of arrayFilters) {
      const identifier = arrayFilterIdentifier(filter);
      if (!referenced.has(identifier)) {
        throw new Error(
          `The array filter for identifier "${identifier}" was not used in the update.`,
        );
      }
    }
  }

  const context: OperatorContext = {
    raw,
    undo,
    query: query as Query,
    arrayFilters,
    allowNullIntermediates: options?.allowNullIntermediates ?? false,
  };

  // Coalesce every write in this call into a single notification.
  batch(() => {
    for (const operator of operatorList) {
      if (operator in operations) {
        operators[operator]!(context, (operations as any)[operator]);
      }
    }
  });

  return { doc, undo: undo as UpdateOperations<T> };
}
