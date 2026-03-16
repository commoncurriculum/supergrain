import { startBatch, endBatch } from 'alien-signals'
import type { Branded } from './core'
import {
  $BRAND,
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $VERSION,
  type Signal,
  unwrap,
} from './core'
import { update as applyUpdate, type UpdateOperations } from './operators'
import { createReactiveProxy, createView } from './read'
import { createModelView, type SchemaLike } from './typed'
import { setProperty } from './write'

export {
  $BRAND,
  $NODE,
  $OWN_KEYS,
  $PROXY,
  $RAW,
  $VERSION,
  type Branded,
  type Signal,
  unwrap,
  createView,
  setProperty,
}

export type SetStoreFunction = (operations: UpdateOperations) => void

export function createStore<S extends SchemaLike>(
  initialState: S['infer'],
  schema: S
): [Branded<S['infer']>, SetStoreFunction, Readonly<S['infer']>]
export function createStore<T extends object>(
  initialState: T
): [Branded<T>, SetStoreFunction]
export function createStore(
  initialState: any,
  schema?: SchemaLike
): [any, SetStoreFunction, any?] {
  const unwrappedState = unwrap(initialState || {})
  const state = createReactiveProxy(unwrappedState)

  function updateStore(operations: UpdateOperations): void {
    startBatch()
    try {
      applyUpdate(unwrappedState, operations)
    } finally {
      endBatch()
    }
  }

  if (schema) {
    const view = createModelView(unwrappedState, schema)
    return [state, updateStore, view]
  }

  return [state, updateStore]
}
