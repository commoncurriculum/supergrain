export { createStore } from "./store";

// Devtools
export { attachReduxDevtools } from "./devtools";
export type { AttachReduxDevtoolsOptions } from "./devtools";

// Testing primitives
export { createFakeAdapter, createFakeQueryAdapter } from "./testing";
export type { FakeAdapter, FakeQueryAdapter } from "./testing";

export type {
  // Model types
  DocumentTypes,
  Doc,
  DocMeta,
  Ref,
  // Adapter responses
  DocumentResponse,
  QueryResponse,
  // Adapters
  DocumentAdapter,
  QueryAdapter,
  // Queries
  QueryDef,
  ResolvedQueryDef,
  // Persistence
  PersistenceAdapter,
  PersistedQueryState,
  // Subscriptions
  SubscribeDocFn,
  SubscribeQueryFn,
  OnInvalidate,
  Unsubscribe,
  // Connection
  ConnectionStatus,
  // Handles
  Status,
  DocumentPromise,
  DocumentsPromise,
  QueryPromise,
  // Store
  Store,
  StoreConfig,
  AcquireOptions,
  StoreEvent,
} from "./types";
