import { startBatch, endBatch } from "alien-signals";

import { $BRAND, type Branded, type Signal, unwrap } from "./core";
import {
  update as applyUpdate,
  type LooseUpdateOperations,
  type StrictUpdateOperations,
} from "./operators";
import { createReactiveProxy } from "./read";

export { $BRAND, type Branded, type Signal, unwrap };

export type SetStoreFunction = (operations: LooseUpdateOperations) => void;

export type StrictSetStoreFunction<T extends object> = (
  operations: StrictUpdateOperations<T>,
) => void;

function normalizeInitialState(initialState: unknown): object {
  if (initialState === null || initialState === undefined) {
    return {};
  }

  const unwrapped = unwrap(initialState);
  if (typeof unwrapped !== "object") {
    throw new TypeError("createStore() requires the root state to be a plain object or array.");
  }

  return unwrapped as object;
}

export function createStore<T extends object>(initialState: T): [Branded<T>, SetStoreFunction];
export function createStore(initialState: any): [any, SetStoreFunction] {
  const unwrappedState = normalizeInitialState(initialState);
  const state = createReactiveProxy(unwrappedState);

  function updateStore(operations: LooseUpdateOperations): void {
    startBatch();
    try {
      applyUpdate(unwrappedState, operations);
    } finally {
      endBatch();
    }
  }

  return [state, updateStore];
}
