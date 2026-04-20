import { $BRAND, type Branded, type Signal, unwrap } from "./core";
import { createReactiveProxy } from "./read";

export { $BRAND, type Branded, type Signal, unwrap };

function normalizeInitialState(initialState: unknown): object {
  if (initialState === null || initialState === undefined) {
    return {};
  }

  const unwrapped = unwrap(initialState);
  if (typeof unwrapped !== "object") {
    throw new TypeError("createReactive() requires the root state to be a plain object or array.");
  }

  return unwrapped as object;
}

export function createReactive<T extends object>(initialState: T): Branded<T>;
export function createReactive(initialState: any): any {
  const unwrappedState = normalizeInitialState(initialState);
  return createReactiveProxy(unwrappedState);
}
