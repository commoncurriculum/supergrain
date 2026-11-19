import type { Query } from "./query";

import { setProperty, deleteProperty } from "@supergrain/kernel/internal";

import { isContainer } from "./util";

export function isArrayIndex(segment: string): boolean {
  return /^\d+$/u.test(segment);
}

export type PathSegment = string;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Depth = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type PrevDepth = [never, 0, 1, 2, 3, 4, 5];

type ArrayKey = `${number}`;
type PositionalArrayKey = ArrayKey | "$" | `$[${string}]`;

type Join<K extends string, P extends string> = `${K}.${P}`;

// Depth-bounded because TypeScript aborts unbounded recursive conditional types
// (TS2589). Paths deeper than `D` are omitted; each extra level multiplies the
// union tsc builds at every `update()` call site, so measure before raising it.
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

export function pathCovers(ancestor: string, path: string): boolean {
  // The separator check keeps "a" from covering "ab".
  return (
    path.startsWith(ancestor) && (path.length === ancestor.length || path[ancestor.length] === ".")
  );
}

export function pathsConflict(a: string, b: string): boolean {
  return pathCovers(a, b) || pathCovers(b, a);
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

export interface PathWriteOptions {
  allowNullIntermediates: boolean;
}

function describeElement(segment: string | undefined, value: unknown): string {
  return segment === undefined ? JSON.stringify(value) : `{${segment}: ${JSON.stringify(value)}}`;
}

export function ensureParentPath(
  target: object,
  path: string,
  options: PathWriteOptions,
): { parent: any; key: string } {
  const parts = splitPath(path);
  const branchPrototype = Object.getPrototypeOf(target) === null ? null : Object.prototype;
  let current: any = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (Array.isArray(current) && !isArrayIndex(part)) {
      throw new TypeError(
        `Cannot create field '${part}' in element ${describeElement(parts[i - 1], current)}.`,
      );
    }
    const existing = (current as any)[part];
    const absent = existing === undefined || (options.allowNullIntermediates && existing === null);
    if (absent) {
      // Mongo pads an out-of-bounds gap with null, not holes.
      if (Array.isArray(current) && isArrayIndex(part)) {
        for (let j = current.length; j < Number(part); j++) {
          setProperty(current, String(j), null);
        }
      }
      setProperty(current, part, Object.create(branchPrototype));
    } else if (!isContainer(existing)) {
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
  options: PathWriteOptions,
): void {
  const { parent, key } = ensureParentPath(target, path, options);
  if (Array.isArray(parent)) {
    if (!isArrayIndex(key)) {
      throw new TypeError(
        `Cannot create field '${key}' in element ${describeElement(splitPath(path).at(-2), parent)}.`,
      );
    }
    // Mongo pads an out-of-bounds gap with null, not holes.
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

// Mongo's $unset leaves null in an array slot (keeping the length). Callers
// must check `hasValueAtPath` first.
export function unsetValueAtPath(target: object, path: string): void {
  const { parent, key } = resolveParentPath(target, path)!;
  if (Array.isArray(parent) && isArrayIndex(key)) {
    setProperty(parent, key, null);
  } else {
    deleteProperty(parent, key);
  }
}

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
  // Mongo ignores the operand; `""` is the idiomatic placeholder.
  [P in Path<T>]?: true | 1 | "";
};

export type NumericPathOperations<T extends object> = {
  [P in NumericPath<T>]?: number;
};

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
