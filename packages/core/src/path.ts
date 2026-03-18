import { setProperty } from "./write";

export type PathSegment = string;

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Depth = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type PrevDepth = [never, 0, 1, 2, 3, 4, 5];

type ArrayKey = `${number}`;

type Join<K extends string, P extends string> = `${K}.${P}`;

export type Path<T, D extends Depth = 5> = [D] extends [0]
  ? never
  : T extends Primitive | Function
    ? never
    : T extends ReadonlyArray<infer U>
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
  ? T extends ReadonlyArray<infer U>
    ? Head extends ArrayKey
      ? PathValue<U, Tail>
      : never
    : Head extends keyof T
      ? PathValue<T[Head], Tail>
      : never
  : T extends ReadonlyArray<infer U>
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
    [P in Path<T>]: PathValue<T, P> extends ReadonlyArray<any> ? P : never;
  }[Path<T>],
  string
>;

type LoosePathMap<K extends string, V> = Partial<Record<K, V>> & Record<string, V>;
type LooseUnknownPathMap<K extends string, V> = Partial<Record<K, V>> & Record<string, unknown>;

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
  if (resolved && Object.prototype.hasOwnProperty.call(resolved.parent, resolved.key)) {
    setProperty(resolved.parent, resolved.key, undefined, true);
  }
}

export type SetPathOperations<T extends object> = LooseUnknownPathMap<
  Path<T>,
  PathValue<T, Path<T>>
>;

export type UnsetPathOperations<T extends object> = LoosePathMap<Path<T>, true | 1>;

export type NumericPathOperations<T extends object> = LoosePathMap<NumericPath<T>, number>;

export type ArrayWriteOperations<T extends object> = LooseUnknownPathMap<
  ArrayPath<T>,
  PathValue<T, ArrayPath<T>> extends Array<infer Item> ? Item | ArrayModifiers<Item> : never
>;

export type ArrayPullOperations<T extends object> = LooseUnknownPathMap<
  ArrayPath<T>,
  PathValue<T, ArrayPath<T>> extends Array<infer Item> ? Item | Partial<Item> : never
>;

export type ArrayModifiers<T> = {
  $each: T[];
};
