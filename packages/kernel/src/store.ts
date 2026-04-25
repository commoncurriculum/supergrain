import { $BRAND, type Branded, type Signal, unwrap } from "./core";
import { createGrainProxy } from "./read";

export { $BRAND, type Branded, type Signal, unwrap };

function normalizeInitialState(initialState: unknown): object {
  if (initialState === null || initialState === undefined) {
    return {};
  }

  const unwrapped = unwrap(initialState);
  if (typeof unwrapped !== "object") {
    throw new TypeError("createGrain() requires the root state to be a plain object or array.");
  }

  return unwrapped as object;
}

export function createGrain<T extends object>(initialState: T): Branded<T>;
export function createGrain(initialState: any): any {
  const unwrappedState = normalizeInitialState(initialState);
  return createGrainProxy(unwrappedState);
}
