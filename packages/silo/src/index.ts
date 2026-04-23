// Root exports — core store types + factory consumers commonly import.
// Specialized surfaces live in subpaths:
//
//   @supergrain/silo/processors          — defaultProcessor
//   @supergrain/silo/processors/json-api — jsonApiProcessor + types
//   @supergrain/silo/react               — Provider + hooks
//   @supergrain/silo/react/json-api      — useBelongsTo / useHasMany

export { createDocumentStore } from "./store";
export type {
  DocumentAdapter,
  DocumentHandle,
  DocumentStore,
  DocumentStoreConfig,
  DocumentTypes,
  ModelConfig,
  RegisteredTypes,
  ResponseProcessor,
  Status,
  TypeRegistry,
} from "./store";

export type {
  QueryAdapter,
  QueryConfig,
  QueryHandle,
  QueryProcessor,
  QueryTypes,
  RegisteredQueries,
} from "./queries";

// Finder is intentionally not exported — it's an internal implementation
// detail of the store (batching / dedup / chunking). Consumers configure
// it through `DocumentStoreConfig.batchWindowMs` and `DocumentStoreConfig.batchSize`.
