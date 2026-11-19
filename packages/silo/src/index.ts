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
  StoreHooks,
  TypeRegistry,
} from "./store";
export type { DocumentsTogetherHandle } from "./together";

export { AdapterError, NotFoundError, ProcessorError } from "./errors";
export type { AdapterErrorReason, SiloError } from "./errors";

export type { AdapterFailureInfo } from "./run-adapter";

export { boundedDefaultRetry, defaultDeadline, defaultRetry } from "./retry";

export type {
  AdapterErrorContext,
  AdapterErrorSink,
  AdapterOptionOverrides,
  ResilienceOptions,
  ResolvedAdapterOptions,
} from "./resolve";

export { createRemoteQueryStore, remoteQuery } from "./remote";
export type {
  PartialParams,
  RemoteQuery,
  RemoteQueryHandle,
  RemoteQueryOptions,
  RemoteQueryStore,
  RemoteQueryStoreConfig,
} from "./remote";

export type {
  QueryAdapter,
  QueryConfig,
  QueryHandle,
  QueryProcessor,
  QueryProcessorContext,
  QueryTypes,
  RegisteredQueries,
} from "./queries";
