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
  ProcessorContext,
  RegisteredTypes,
  ResponseProcessor,
  StoreAdapterRunOptions,
  TypeRegistry,
} from "./store";

export { AdapterError, NotFoundError, ProcessorError } from "./errors";
export type { AdapterErrorReason, SiloError } from "./errors";

// The raw engine entrypoint lives in `@supergrain/silo/internal`; the public
// boundary for layered packages is `store.runAdapter`, which resolves options,
// reports to the store's `onError` sink, and shares the `maxConcurrency` cap.
export type { AdapterFailureInfo } from "./run-adapter";

export { boundedDefaultRetry, defaultDeadline, defaultRetry } from "./retry";

// Resolution itself is reached through `store.resolveAdapterOptions(perCall?)`;
// only the option shapes are public.
export type {
  AdapterErrorContext,
  AdapterErrorSink,
  AdapterOptionOverrides,
  ResilienceOptions,
  ResolvedAdapterOptions,
} from "./resolve";

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
