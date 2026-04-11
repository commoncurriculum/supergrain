import type { StoreConfig } from "../src";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createStore } from "../src";
import { makeStore } from "./helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// =============================================================================
// createStore — API surface and baseline behavior
// =============================================================================

describe("createStore", () => {
  it("returns a store exposing the full public API surface", () => {
    const { store } = makeStore();

    expect(typeof store.findDoc).toBe("function");
    expect(typeof store.query).toBe("function");
    expect(typeof store.acquireDoc).toBe("function");
    expect(typeof store.acquireQuery).toBe("function");
    expect(typeof store.insertDocument).toBe("function");
    expect(typeof store.setConnection).toBe("function");
    expect(typeof store.onReconnect).toBe("function");
    expect(typeof store.subscribe).toBe("function");
  });

  it("connection defaults to ONLINE", () => {
    const { store } = makeStore();
    expect(store.connection).toBe("ONLINE");
  });

  it("setConnection updates the reactive connection field", () => {
    const { store } = makeStore();

    expect(store.connection).toBe("ONLINE");

    store.setConnection("OFFLINE");
    expect(store.connection).toBe("OFFLINE");

    store.setConnection("DEGRADED");
    expect(store.connection).toBe("DEGRADED");

    store.setConnection("ONLINE");
    expect(store.connection).toBe("ONLINE");
  });

  it("throws a clear error when findDoc is called with an unregistered type", () => {
    // Deliberately cast to bypass compile-time check — this guards the
    // runtime path for untyped callers.
    type AnyModels = Record<string, unknown>;
    const store = createStore<AnyModels>({
      adapters: {},
    } as StoreConfig<AnyModels>);

    expect(() => store.findDoc("not-registered", "1")).toThrow(/no.*adapter.*not-registered/i);
  });

  it("throws a clear error when query is called with an unregistered query type", () => {
    const { store } = makeStore();

    expect(() => store.query({ type: "not-registered", id: "u1" })).toThrow(
      /no.*quer.*not-registered/i,
    );
  });

  it("throws a clear error when acquireDoc is called with an unregistered type", () => {
    type AnyModels = Record<string, unknown>;
    const store = createStore<AnyModels>({
      adapters: {},
    } as StoreConfig<AnyModels>);

    expect(() => store.acquireDoc("not-registered", "1")).toThrow(/no.*adapter.*not-registered/i);
  });
});
