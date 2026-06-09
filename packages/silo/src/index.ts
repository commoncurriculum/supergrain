// Root exports — core store types + factory consumers commonly import.
// Specialized surfaces live in subpaths:
//
//   @supergrain/silo/processors          — defaultProcessor
//   @supergrain/silo/processors/json-api — jsonApiProcessor + types
//   @supergrain/silo/react               — Provider + hooks
//   @supergrain/silo/react/json-api      — useBelongsTo / useHasMany
//   @supergrain/silo/internal            — handle statechart, for layered packages

export { createDocumentStore } from "./store";
export type {
  DocumentAdapter,
  DocumentHandle,
  DocumentStore,
  DocumentStoreConfig,
  DocumentTypes,
  HandleStatus,
  ModelConfig,
  RegisteredTypes,
  ResponseProcessor,
  TypeRegistry,
} from "./store";

export { AdapterError, NotFoundError, ProcessorError } from "./errors";
export type { AdapterErrorReason, SiloError } from "./errors";

export { runAdapter } from "./run-adapter";
export type { AdapterFailureInfo, AdapterRunOptions } from "./run-adapter";

export { defaultRetry } from "./retry";

// Resolution itself is reached through `store.resolveAdapterOptions(perCall?)`;
// only the option shapes are public.
export type { AdapterOptionOverrides, ResolvedAdapterOptions } from "./resolve";

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
