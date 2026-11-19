// Not public API: shapes here may change in minor releases.
export { applyEvent, HandleEvent, type InternalHandle, makeIdleHandle } from "./transitions";
export { type AdapterRunOptions, runAdapter } from "./run-adapter";
export { defectToAdapterError, runProcessor } from "./errors";
export { emitToSink } from "./resolve";
export { type Flight, runSingleFlight, type SingleFlightOptions } from "./single-flight";
