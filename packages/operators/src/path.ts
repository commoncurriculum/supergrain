import { setProperty, deleteProperty } from "@supergrain/core/internal";

export type PathSegment = string;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Depth = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type PrevDepth = [never, 0, 1, 2, 3, 4, 5];

type ArrayKey = `${number}`;

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
  : T extends Primitive | ((...args: never[]) => unknown)
    ? never
    : T extends readonly (infer U)[]
      ? ArrayKey | Join<ArrayKey, Path<U, PrevDepth[D]>>
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
  ? T extends readonly (infer U)[]
    ? Head extends ArrayKey
      ? PathValue<U, Tail>
      : never
    : Head extends keyof T
      ? PathValue<T[Head], Tail>
      : never
  : T extends readonly (infer U)[]
    ? P extends ArrayKey
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
    [P in Path<T>]: PathValue<T, P> extends readonly any[] ? P : never;
  }[Path<T>],
  string
>;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

export function splitPath(path: string): PathSegment[] {
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

export function ensureParentPath(target: object, path: string): { parent: any; key: string } {
  const parts = splitPath(path);
  let current: any = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const existing = (current as any)[part];
    if (!isContainer(existing)) {
      setProperty(current, part, {});
    }
    current = (current as any)[part];
  }

  return { parent: current, key: parts[parts.length - 1]! };
}

export function setValueAtPath(target: object, path: string, value: unknown): void {
  const { parent, key } = ensureParentPath(target, path);
  setProperty(parent, key, value);
}

export function deleteValueAtPath(target: object, path: string): void {
  const resolved = resolveParentPath(target, path);
  if (resolved && Object.hasOwn(resolved.parent, resolved.key)) {
    deleteProperty(resolved.parent, resolved.key);
  }
}

export type SetPathOperations<T extends object> = {
  [P in Path<T>]?: PathValue<T, P>;
};

export type UnsetPathOperations<T extends object> = {
  [P in Path<T>]?: true | 1;
};

export type NumericPathOperations<T extends object> = {
  [P in NumericPath<T>]?: number;
};

export type ArrayWriteOperations<T extends object> = {
  [P in ArrayPath<T>]?: PathValue<T, P> extends (infer Item)[]
    ? Item | ArrayModifiers<Item>
    : never;
};

export type ArrayPullOperations<T extends object> = {
  [P in ArrayPath<T>]?: PathValue<T, P> extends (infer Item)[] ? Item | Partial<Item> : never;
};

export interface ArrayModifiers<T> {
  $each: T[];
}
