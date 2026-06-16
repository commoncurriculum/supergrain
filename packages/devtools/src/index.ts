// @supergrain/devtools — framework-agnostic core.
//
// This entry has no React dependency: it's the data layer the UI is built on,
// and is equally usable from a custom inspector, a test, or a logger. The React
// panel lives at `@supergrain/devtools/react`.
//
// Today it inspects a silo `DocumentStore`. The shapes here are intentionally
// generic (snapshots + a serialized value tree) so future inspectors — a raw
// `@supergrain/kernel` store, the profiler — can plug into the same UI shell.

export {
  getSiloDevtools,
  type SiloDevtoolsBridge,
  type SiloEntryKind,
  type SiloEntrySnapshot,
  type SiloStoreSnapshot,
  type SiloTypeSnapshot,
  type SnapshotOptions,
  snapshotSilo,
} from "./silo";

export { type JsonNode, serialize, type SerializeOptions } from "./serialize";
