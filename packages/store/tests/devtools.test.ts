import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { attachReduxDevtools, createStore, createFakeAdapter } from "../src";

interface User {
  firstName: string;
}

type Models = {
  user: User;
};

// =============================================================================
// Mock __REDUX_DEVTOOLS_EXTENSION__
// =============================================================================

interface MockConnection {
  init: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

interface MockExtension {
  connect: ReturnType<typeof vi.fn>;
  _connections: MockConnection[];
}

function installMockExtension(): MockExtension {
  const connections: MockConnection[] = [];
  const ext: MockExtension = {
    connect: vi.fn((_opts: { name: string }) => {
      const conn: MockConnection = {
        init: vi.fn(),
        send: vi.fn(),
        unsubscribe: vi.fn(),
      };
      connections.push(conn);
      return conn;
    }),
    _connections: connections,
  };
  (
    globalThis as unknown as { __REDUX_DEVTOOLS_EXTENSION__: unknown }
  ).__REDUX_DEVTOOLS_EXTENSION__ = ext;
  return ext;
}

function uninstallMockExtension() {
  delete (globalThis as unknown as { __REDUX_DEVTOOLS_EXTENSION__?: unknown })
    .__REDUX_DEVTOOLS_EXTENSION__;
}

function makeStore() {
  const userAdapter = createFakeAdapter<User>({ "1": { firstName: "Alice" } });
  return createStore<Models>({
    adapters: { user: userAdapter.adapter },
    batchWindowMs: 15,
  });
}

// =============================================================================
// Tests
// =============================================================================

describe("attachReduxDevtools", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    uninstallMockExtension();
    vi.useRealTimers();
  });

  it("is a no-op when the extension isn't installed", () => {
    // No mock installed
    const store = makeStore();

    const detach = attachReduxDevtools(store, { name: "test" });

    expect(typeof detach).toBe("function");
    // Detach must not throw
    expect(() => detach()).not.toThrow();
  });

  it("connects to the extension with the provided name", () => {
    const ext = installMockExtension();
    const store = makeStore();

    attachReduxDevtools(store, { name: "my-store" });

    expect(ext.connect).toHaveBeenCalledTimes(1);
    expect(ext.connect).toHaveBeenCalledWith(expect.objectContaining({ name: "my-store" }));
    expect(ext._connections).toHaveLength(1);
    expect(ext._connections[0].init).toHaveBeenCalled();
  });

  it("defaults the name to '@supergrain/store' when not provided", () => {
    const ext = installMockExtension();
    const store = makeStore();

    attachReduxDevtools(store);

    expect(ext.connect).toHaveBeenCalledWith(
      expect.objectContaining({ name: "@supergrain/store" }),
    );
  });

  // These tests exercise event forwarding — they depend on `store.subscribe`
  // being implemented (currently a stub), so they fail until the store ships.

  it("forwards doc-fetch-start and doc-fetch-success events to devtools", async () => {
    const ext = installMockExtension();
    const store = makeStore();

    attachReduxDevtools(store, { name: "test" });
    const conn = ext._connections[0];

    store.findDoc("user", "1");
    await vi.advanceTimersByTimeAsync(25);

    const actionTypes = conn.send.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(actionTypes.some((t) => t.startsWith("doc-fetch-start"))).toBe(true);
    expect(actionTypes.some((t) => t.startsWith("doc-fetch-success"))).toBe(true);
  });

  it("includes the event payload in the sent action", async () => {
    const ext = installMockExtension();
    const store = makeStore();

    attachReduxDevtools(store);
    const conn = ext._connections[0];

    store.findDoc("user", "1");
    await vi.advanceTimersByTimeAsync(25);

    const firstCall = conn.send.mock.calls[0];
    expect(firstCall[0]).toEqual(
      expect.objectContaining({
        type: expect.any(String),
        payload: expect.objectContaining({ kind: expect.any(String) }),
      }),
    );
  });

  it("calls getState for state snapshots when provided", async () => {
    installMockExtension();
    const store = makeStore();
    const getState = vi.fn(() => ({ fake: "state" }));

    attachReduxDevtools(store, { getState });

    store.findDoc("user", "1");
    await vi.advanceTimersByTimeAsync(25);

    // At least the initial init call + one event call after fetch
    expect(getState).toHaveBeenCalled();
  });

  it("detach unsubscribes from the store and closes the connection", async () => {
    const ext = installMockExtension();
    const store = makeStore();

    const detach = attachReduxDevtools(store);
    const conn = ext._connections[0];

    detach();

    // Subsequent events should not reach the connection
    store.findDoc("user", "1");
    await vi.advanceTimersByTimeAsync(25);

    expect(conn.send).not.toHaveBeenCalled();
  });
});
