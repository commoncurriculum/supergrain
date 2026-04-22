// Root exports — core store types + factory consumers commonly import.
// Specialized surfaces live in subpaths:
//
//   @supergrain/document-store/processors          — defaultProcessor
//   @supergrain/document-store/processors/json-api — jsonApiProcessor + types
//   @supergrain/document-store/react               — Provider + hooks
//   @supergrain/document-store/react/json-api      — useBelongsTo / useHasMany

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
