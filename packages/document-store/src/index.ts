// Root exports — core classes + types consumers commonly import.
// Specialized surfaces live in subpaths:
//
//   @supergrain/document-store/processors          — defaultProcessor
//   @supergrain/document-store/processors/json-api — jsonApiProcessor + types
//   @supergrain/document-store/react               — Provider + hooks
//   @supergrain/document-store/react/json-api      — useBelongsTo / useHasMany

export { DocumentStore } from "./store";
export type { DocumentHandle, DocumentsHandle } from "./store";

export { Finder } from "./finder";
export type { DocumentAdapter, ResponseProcessor } from "./finder";

export type { DocumentTypes, TypeRegistry, RegisteredTypes } from "./memory";
