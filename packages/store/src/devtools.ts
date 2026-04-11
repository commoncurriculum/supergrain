import type { DocumentTypes, Store, StoreEvent, Unsubscribe } from "./types";

// =============================================================================
// Redux DevTools Extension shape (minimal — we only use `connect`/`send`/`init`)
// =============================================================================

interface ReduxDevtoolsConnection {
  init(state: unknown): void;
  send(action: { type: string; payload?: unknown }, state: unknown): void;
  unsubscribe?(): void;
}

interface ReduxDevtoolsExtension {
  connect(options: { name: string; [key: string]: unknown }): ReduxDevtoolsConnection;
}

interface WindowWithDevtools {
  __REDUX_DEVTOOLS_EXTENSION__?: ReduxDevtoolsExtension;
}

// =============================================================================
// Public API
// =============================================================================

export interface AttachReduxDevtoolsOptions {
  /** Instance name shown in the DevTools panel. */
  name?: string;

  /**
   * Called each time an event fires, to produce a state snapshot to send
   * alongside the action. Return `undefined` to skip state (action-log only).
   * Defaults to always returning `undefined`.
   */
  getState?: () => unknown;
}

/**
 * Attach the store to the Redux DevTools browser extension.
 *
 * Forwards every `StoreEvent` from `store.subscribe` to the extension as a
 * Redux-style action. If the extension isn't installed, this is a no-op and
 * returns a no-op detach function.
 *
 * @returns A detach function that unsubscribes from the store and disconnects
 *   the DevTools session.
 *
 * @example
 * ```ts
 * const store = createStore(...)
 * const detach = attachReduxDevtools(store, { name: "cc-store" })
 * // Later:
 * detach()
 * ```
 */
export function attachReduxDevtools<M extends DocumentTypes>(
  store: Store<M>,
  options: AttachReduxDevtoolsOptions = {},
): Unsubscribe {
  const ext = (globalThis as WindowWithDevtools).__REDUX_DEVTOOLS_EXTENSION__;
  if (!ext) {
    return () => {};
  }

  const name = options.name ?? "@supergrain/store";
  const getState = options.getState ?? (() => undefined);

  const connection = ext.connect({ name });
  connection.init(getState());

  const unsubscribe = store.subscribe((event: StoreEvent) => {
    connection.send({ type: eventToActionType(event), payload: event }, getState());
  });

  return () => {
    unsubscribe();
    connection.unsubscribe?.();
  };
}

function eventToActionType(event: StoreEvent): string {
  switch (event.kind) {
    case "doc-fetch-start":
    case "doc-fetch-success":
    case "doc-fetch-error":
      return `${event.kind}(${event.type}:${event.ids.join(",")})`;
    case "doc-insert":
      return `${event.kind}(${event.type}:${event.id})`;
    case "query-fetch-start":
    case "query-fetch-success":
    case "query-fetch-error":
      return `${event.kind}(${event.key})`;
    case "invalidate-doc":
      return `${event.kind}(${event.type}:${event.id})`;
    case "invalidate-query":
      return `${event.kind}(${event.key})`;
    case "connection-change":
      return `${event.kind}(${event.status})`;
  }
}
