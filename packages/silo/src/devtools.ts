// Not public API: shapes here may change in minor releases. Devtools must read
// `state` directly; going through `find` would enqueue fetches.

import type { InternalState } from "./store";

/**
 * Key of every `DocumentStore`'s {@link SiloDevtoolsBridge}. `Symbol.for`, so a
 * client bundled with a different copy of this module still finds it.
 */
export const SILO_DEVTOOLS = Symbol.for("@supergrain/silo.devtools");

/** The introspection handle returned by {@link getSiloDevtools}. */
export interface SiloDevtoolsBridge {
  /** The store's live reactive state; read it inside `effect()` / `tracked()` to subscribe. */
  readonly state: InternalState;
  readonly documentTypes: ReadonlyArray<string>;
  readonly queryTypes: ReadonlyArray<string>;
  clearMemory(): void;
}

export type { InternalState } from "./store";
export type { InternalHandle } from "./transitions";
export type { HandleStatus } from "./store";

export function attachSiloDevtools(store: object, bridge: SiloDevtoolsBridge): void {
  Object.defineProperty(store, SILO_DEVTOOLS, {
    value: bridge,
    enumerable: false,
    configurable: true,
    writable: false,
  });
}

/** The store's {@link SiloDevtoolsBridge}, or `undefined` if `store` isn't a silo store. */
export function getSiloDevtools(store: unknown): SiloDevtoolsBridge | undefined {
  if (store === null || (typeof store !== "object" && typeof store !== "function")) {
    return undefined;
  }
  return (store as Record<symbol, SiloDevtoolsBridge | undefined>)[SILO_DEVTOOLS];
}
