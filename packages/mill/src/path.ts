import type { Query } from "./query";

import { setProperty, deleteProperty } from "@supergrain/kernel/internal";

import { isContainer } from "./util";

/** Whether a path segment is a non-negative integer array index (`"0"`, `"3"`). */
export function isArrayIndex(segment: string): boolean {
  return /^\d+$/u.test(segment);
}

export type PathSegment = string;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Depth = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type PrevDepth = [never, 0, 1, 2, 3, 4, 5];

type ArrayKey = `${number}`;
// Array segments accept a concrete index or one of MongoDB's positional tokens:
// `$` (first element matched by the query), `$[]` (every element), and
// `$[<identifier>]` (every element matched by the corresponding arrayFilter).
// The `` `$[${string}]` `` template covers both `$[]` and `$[<identifier>]`.
type PositionalArrayKey = ArrayKey | "$" | `$[${string}]`;

type Join<K extends string, P extends string> = `${K}.${P}`;

/**
 * Recursive dotted-path type for `T`, bounded by depth `D` (default `5`).
 *
 * **Depth limit (default 5):**
 * TypeScript caps recursion in conditional types — when this type recurses
 * past its instantiation depth limit, the compiler aborts with TS2589
 * ("Type instantiation is excessively deep and possibly infinite") or
 * silently produces `any`. The `Depth`/`PrevDepth` decrementer here keeps
 * recursion bounded so that doesn't happen.
 *
 * **What happens past the limit:**
 * Paths *deeper* than `D` levels are simply absent from the union `Path<T>`
 * resolves to — so the strict path operation maps (`SetPathOperations`,
 * `UnsetPathOperations`, ...) will reject them. Consumers that need deeper
 * paths must pass an explicit `D`: `Path<MyShape, 6>`.
 *
 * **Cost of raising `D`:**
 * Every level multiplies the union size that `tsc` materialises for every
 * `update()` call site in consumers. For deeply-nested or wide types this
 * compounds quickly and shows up as noticeably slower IDE feedback +
 * `tsc --noEmit` runs. Don't bump the default without measuring against a
 * realistic consumer schema first.
 */
export type Path<T, D extends Depth = 5> = [D] extends [0]
  ? never
  : T extends Primitive | ((...args: Array<never>) => unknown)
    ? never
    : T extends ReadonlyArray<infer U>
      ? PositionalArrayKey | Join<PositionalArrayKey, Path<U, PrevDepth[D]>>
      : T extends object
        ? {
            [K in Extract<keyof T, string>]:
              | K
              | (Path<T[K], PrevDepth[D]> extends never
                  ? never
                  : Join<K, Path<T[K], PrevDepth[D]>>);
          }[Extract<keyof T, string>]
        : never;

export type PathValue<T, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? T extends ReadonlyArray<infer U>
    ? Head extends PositionalArrayKey
      ? PathValue<U, Tail>
      : never
    : Head extends keyof T
      ? PathValue<T[Head], Tail>
      : never
  : T extends ReadonlyArray<infer U>
    ? P extends PositionalArrayKey
      ? U
      : never
    : P extends keyof T
      ? T[P]
      : never;

type KnownPathByValue<T, Value> = Extract<
  {
    [P in Path<T>]: PathValue<T, P> extends Value ? P : never;
  }[Path<T>],
  string
>;

export type NumericPath<T> = KnownPathByValue<T, number | null | undefined>;
export type ArrayPath<T> = Extract<
  {
    [P in Path<T>]: PathValue<T, P> extends ReadonlyArray<any> ? P : never;
  }[Path<T>],
  string
>;

export function splitPath(path: string): Array<PathSegment> {
  if (path.length === 0) {
    throw new Error("Update paths must not be empty.");
  }

  const parts = path.split(".");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`Invalid update path "${path}". Empty path segments are not allowed.`);
  }

  return parts;
}

export function resolveParentPath(
  target: object,
  path: string,
): { parent: any; key: string } | null {
  const parts = splitPath(path);
  let current: any = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!isContainer(current)) {
      return null;
    }
    current = (current as any)[part];
  }

  if (!isContainer(current)) {
    return null;
  }

  return { parent: current, key: parts[parts.length - 1]! };
}

/**
 * Options shared by the path-*writing* helpers (`ensureParentPath`,
 * `setValueAtPath`).
 */
export interface PathWriteOptions {
  /**
   * Treat a `null` intermediate the way an *absent* one is treated: overwrite it
   * with a freshly-created branch rather than rejecting. Off by default so mill
   * stays faithful to MongoDB (which throws "Cannot create field ... in element
   * {x: null}"); opt in via `update(..., { allowNullIntermediates: true })`.
   */
  allowNullIntermediates?: boolean;
}

export function ensureParentPath(
  target: object,
  path: string,
  options: PathWriteOptions = {},
): { parent: any; key: string } {
  const parts = splitPath(path);
  // Fabricated branches match the document's flavor: a null-prototype document
  // grows null-prototype branches, a plain-object document grows plain ones.
  const branchPrototype = Object.getPrototypeOf(target) === null ? null : Object.prototype;
  let current: any = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = (current as any)[part];
    // A `null` intermediate is normally a hard error (Mongo can't create a
    // field inside null); with `allowNullIntermediates` it's treated as absent
    // and overwritten by the created branch.
    const absent = existing === undefined || (options.allowNullIntermediates && existing === null);
    if (absent) {
      // Absent intermediate — Mongo creates the missing branch as an object.
      // Growing an array through an out-of-bounds index pads the gap with null
      // (Mongo's behavior) rather than leaving sparse holes.
      if (Array.isArray(current) && isArrayIndex(part)) {
        for (let j = current.length; j < Number(part); j++) {
          setProperty(current, String(j), null);
        }
      }
      setProperty(current, part, Object.create(branchPrototype));
    } else if (!isContainer(existing)) {
      // A scalar (number/string/boolean/null) can't gain a subfield: Mongo
      // rejects rather than silently overwriting it. e.g. {a: 42} + "a.b".
      throw new TypeError(
        `Cannot create field '${parts[i + 1]}' in element {${part}: ${JSON.stringify(existing)}}.`,
      );
    }
    current = (current as any)[part];
  }

  return { parent: current, key: parts[parts.length - 1]! };
}

export function setValueAtPath(
  target: object,
  path: string,
  value: unknown,
  options: PathWriteOptions = {},
): void {
  const { parent, key } = ensureParentPath(target, path, options);
  if (Array.isArray(parent) && isArrayIndex(key)) {
    // Writing past the end grows the array; Mongo pads the gap with null rather
    // than leaving holes. e.g. [1] + "scores.3" -> [1, null, null, 4].
    for (let i = parent.length; i < Number(key); i++) {
      setProperty(parent, String(i), null);
    }
  }
  setProperty(parent, key, value);
}

export function deleteValueAtPath(target: object, path: string): void {
  const resolved = resolveParentPath(target, path);
  if (resolved && Object.hasOwn(resolved.parent, resolved.key)) {
    deleteProperty(resolved.parent, resolved.key);
  }
}

/**
 * `$unset` semantics: removing an *array element* leaves a `null` in its place
 * (Mongo keeps the array length); removing an *object property* deletes the key.
 * The caller ($unset) guarantees the path exists (via `hasValueAtPath`).
 */
export function unsetValueAtPath(target: object, path: string): void {
  const { parent, key } = resolveParentPath(target, path)!;
  if (Array.isArray(parent) && isArrayIndex(key)) {
    setProperty(parent, key, null);
  } else {
    deleteProperty(parent, key);
  }
}

/**
 * Read the value at a dotted path, returning `undefined` if any segment along
 * the way is missing or not a container. Never throws on a missing path (it
 * does validate path *syntax* via `splitPath`).
 */
export function getValueAtPath(target: unknown, path: string): unknown {
  const parts = splitPath(path);
  let current: any = target;

  for (const part of parts) {
    if (!isContainer(current)) {
      return undefined;
    }
    current = (current as any)[part];
  }

  return current;
}

/** Whether the leaf key at `path` is an own property of its (container) parent. */
export function hasValueAtPath(target: unknown, path: string): boolean {
  const parts = splitPath(path);
  let current: any = target;

  for (let i = 0; i < parts.length - 1; i++) {
    if (!isContainer(current)) {
      return false;
    }
    current = (current as any)[parts[i]!];
  }

  return isContainer(current) && Object.hasOwn(current, parts[parts.length - 1]!);
}

export type SetPathOperations<T extends object> = {
  [P in Path<T>]?: PathValue<T, P>;
};

export type UnsetPathOperations<T extends object> = {
  // Mongo ignores the operand; `""` is its idiomatic placeholder (and what
  // generated undo documents use), `1`/`true` are accepted for convenience.
  [P in Path<T>]?: true | 1 | "";
};

export type NumericPathOperations<T extends object> = {
  [P in NumericPath<T>]?: number;
};

/**
 * Standard MongoDB `$push` modifiers. No mill-specific additions — `$each`,
 * `$position`, `$slice`, and `$sort` are exactly Mongo's.
 */
export interface ArrayModifiers<T> {
  $each: Array<T>;
  $position?: number;
  $slice?: number;
  $sort?: 1 | -1 | Record<string, 1 | -1>;
}

export type ArrayWriteOperations<T extends object> = {
  [P in ArrayPath<T>]?: PathValue<T, P> extends Array<infer Item>
    ? Item | ArrayModifiers<Item>
    : never;
};

export type ArrayPushOperations<T extends object> = {
  [P in ArrayPath<T>]?: PathValue<T, P> extends Array<infer Item>
    ? Item | ArrayModifiers<Item>
    : never;
};

export type ArrayPullOperations<T extends object> = {
  // $pull removes elements matching a value, a partial document, or a Mongo
  // query condition ({ $gte: 4 } on scalars, { field: { $gte: 5 } } on docs) —
  // the same condition grammar the query matcher understands.
  [P in ArrayPath<T>]?: PathValue<T, P> extends Array<infer Item>
    ? Item | Partial<Item> | Query<Item>
    : never;
};

export type ArrayPullAllOperations<T extends object> = {
  [P in ArrayPath<T>]?: PathValue<T, P> extends Array<infer Item> ? Array<Item> : never;
};

export type ArrayPopOperations<T extends object> = {
  [P in ArrayPath<T>]?: 1 | -1;
};
