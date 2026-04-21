// Root exports — core classes + types consumers commonly import.
// Specialized surfaces live in subpaths:
//
//   @supergrain/document-store/processors          — defaultProcessor
//   @supergrain/document-store/processors/json-api — jsonApiProcessor + types
//   @supergrain/document-store/react               — Provider + hooks
//   @supergrain/document-store/react/json-api      — useBelongsTo / useHasMany

export { DocumentStore } from "./store";
export type {
  DocumentAdapter,
  DocumentHandle,
  DocumentsHandle,
  DocumentStoreConfig,
  ModelConfig,
  ResponseProcessor,
  Status,
} from "./store";

export type { DocumentTypes, TypeRegistry, RegisteredTypes } from "./memory";

// Finder is intentionally not exported — it's an internal implementation
// detail of DocumentStore (batching / dedup / chunking). Consumers configure
// it through `DocumentStoreConfig.batchWindowMs` and `DocumentStoreConfig.batchSize`.
