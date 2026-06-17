// Devtools bridge — the stable, first-party introspection surface a
// `DocumentStore` exposes so tooling (e.g. `@supergrain/devtools`) can read and
// subscribe to its internal state WITHOUT going through the public `find` /
// `findQuery` API (which would enqueue fetches for keys the app never asked
// for). Inspecting a store must be purely observational.
//
// The bridge is attached as a non-enumerable, `Symbol.for`-keyed property so it
// never widens the typed `DocumentStore` surface and never shows up in
// `Object.keys` / `JSON.stringify` of a store. It is always attached (dev and
// prod), the intentional devtools-hook pattern (cf. React/Redux): the cost is
// one `defineProperty` at store creation, and the bridge holds no retention the
// store didn't already have — `state` is captured by the store's own methods,
// so the bridge adds no GC root and nothing is computed until a devtools client
// reads it. (`@supergrain/devtools` gates whether the *panel* renders via its
// `disabled` prop; the bridge itself stays, like `window.__REDUX_DEVTOOLS…`.)
// Mirrors how `@supergrain/kernel/internal` exposes machinery to layered
// packages: not part of the public API contract, shapes here may change in
// minor releases.

import type { InternalState } from "./store";

/**
 * Well-known key under which every `DocumentStore` exposes its
 * {@link SiloDevtoolsBridge}. Uses `Symbol.for` so a devtools client compiled
 * against a different copy of this module still finds it.
 */
export const SILO_DEVTOOLS: unique symbol = Symbol.for("@supergrain/silo.devtools");

/**
 * The introspection handle a devtools client reads off a store via
 * {@link getSiloDevtools}. Holds the live reactive `state` (so a client can
 * subscribe with the kernel's `effect()` / `tracked()`), the configured type
 * names (so empty types still appear in the inspector), and a `clearMemory`
 * escape hatch that doesn't require the store's `M` / `Q` generics.
 */
export interface SiloDevtoolsBridge {
  /**
   * The store's live, reactive internal state. Iterating its `documents` /
   * `queries` maps inside a kernel `effect()` (or a `tracked()` component)
   * subscribes to structural changes; reading a handle's fields subscribes to
   * those fields, so a devtools view re-renders exactly when the store changes.
   */
  readonly state: InternalState;
  /** Document model type names declared in `DocumentStoreConfig.models`. */
  readonly documentTypes: ReadonlyArray<string>;
  /** Query type names declared in `DocumentStoreConfig.queries` (empty if none). */
  readonly queryTypes: ReadonlyArray<string>;
  /** Reset every cached document and query result (delegates to `store.clearMemory`). */
  clearMemory(): void;
}

// Re-export the handle/state shapes a client renders, so a devtools package
// reads them from the devtools entry point alone rather than reaching into
// `./store` / `./internal`.
export type { InternalState } from "./store";
export type { InternalHandle } from "./transitions";
export type { HandleStatus } from "./store";

/**
 * Attach a {@link SiloDevtoolsBridge} to `store` under {@link SILO_DEVTOOLS}.
 * Called once by `createDocumentStore`. Non-enumerable + configurable so it
 * stays invisible to enumeration but can be redefined (e.g. by a test harness).
 */
export function attachSiloDevtools(store: object, bridge: SiloDevtoolsBridge): void {
  Object.defineProperty(store, SILO_DEVTOOLS, {
    value: bridge,
    enumerable: false,
    configurable: true,
    writable: false,
  });
}

/**
 * Read the {@link SiloDevtoolsBridge} off a store, or `undefined` if the value
 * isn't a silo store (or predates devtools support). The single entry point a
 * devtools client uses to go from a `DocumentStore` reference to something
 * inspectable.
 */
export function getSiloDevtools(store: unknown): SiloDevtoolsBridge | undefined {
  if (store === null || (typeof store !== "object" && typeof store !== "function")) {
    return undefined;
  }
  return (store as Record<symbol, SiloDevtoolsBridge | undefined>)[SILO_DEVTOOLS];
}
