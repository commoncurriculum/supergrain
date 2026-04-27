// =============================================================================
// example-app.ts
// =============================================================================
//
// Realistic consumer wiring for @supergrain/silo. In a real codebase
// this would live at `services/store.ts` (or equivalent): domain models, HTTP
// adapters (real fetch-based), and the one-time Silo composition.
//
// Adapters intentionally cover two styles:
//
//   user       — BULK fetch: one GET /users?id=1&id=2 per chunk
//   post       — FAN-OUT fetch: N parallel GET /posts/:id, merged
//   card-stack — BULK fetch + JSON-API envelope (processor uses jsonApi)
//
// The library doesn't care which style an adapter picks; the store wires the
// same regardless. Tests use this to prove both styles work end-to-end.
//
// Tests use MSW (Mock Service Worker) to intercept the network at the fetch
// layer. Adapters don't know they're being tested — they just call fetch()
// like they would in production. MSW answers with canned documents and
// records every request for assertion.
//
// Config options visible in initStore:
//   - ModelConfig.adapter                 (every model)
//   - ModelConfig.processor               (card-stack uses jsonApiProcessor;
//                                          user and post use the default)
//   - SiloConfig.batchWindowMs   (overridable via initStore options)
//   - SiloConfig.batchSize       (overridable via initStore options)
//
// Test lifecycle (put at the top of each test file):
//   beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
//   afterEach(() => { server.resetHandlers(); clearRequests(); });
//   afterAll(() => server.close());
// =============================================================================

import { http, HttpResponse, type HttpHandler } from "msw";
import { setupServer } from "msw/node";
import { vi } from "vitest";

import {
  createSilo,
  type DocumentAdapter,
  type QueryAdapter,
  type Silo,
  type SiloConfig,
} from "../src";
import { jsonApiProcessor } from "../src/processors/json-api";

// ─── Domain models ──────────────────────────────────────────────────────────
//
// User has NO `type` field — the library doesn't require one. The type is
// supplied externally at every API boundary (`store.find("user", id)` etc.).
// Post also omits type. CardStack retains type because JSON-API's envelope
// carries it inline, and jsonApiProcessor reads it from there.

export interface User {
  id: string;
  attributes: { firstName: string; lastName: string; email: string };
}

export interface Post {
  id: string;
  attributes: { title: string; body: string; authorId: string };
}

export interface CardStack {
  id: string;
  type: "card-stack";
  attributes: { title: string; slug: string };
}

export type TypeToModel = {
  user: User;
  post: Post;
  "card-stack": CardStack;
};

// ─── Query types ────────────────────────────────────────────────────────────
//
// Dashboard — a query-keyed model. Params are a structured `{ workspaceId,
// filters }` object; the result is the dashboard payload with no natural
// `id`. The library stable-stringifies the params for cache identity.
//
// `TypeToQuery` is the consumer's query type map — parallel to `TypeToModel`.
// Each entry declares `params` (the cache key) and `result` (the payload).

export interface Dashboard {
  totalActiveUsers: number;
  recentPostIds: Array<string>;
}

export interface DashboardParams {
  workspaceId: number;
  filters: { active: boolean };
}

export type TypeToQuery = {
  dashboard: { params: DashboardParams; result: Dashboard };
};

// ─── Document factories (test-only) ─────────────────────────────────────────

export function makeUser(id: string, overrides: Partial<User["attributes"]> = {}): User {
  return {
    id,
    attributes: {
      firstName: `User${id}`,
      lastName: "Test",
      email: `user${id}@example.com`,
      ...overrides,
    },
  };
}

export function makePost(id: string, overrides: Partial<Post["attributes"]> = {}): Post {
  return {
    id,
    attributes: {
      title: `Post${id}`,
      body: "body",
      authorId: "1",
      ...overrides,
    },
  };
}

export function makeCardStack(
  id: string,
  overrides: Partial<CardStack["attributes"]> = {},
): CardStack {
  return {
    id,
    type: "card-stack",
    attributes: {
      title: `Card Stack ${id}`,
      slug: `card-stack-${id}`,
      ...overrides,
    },
  };
}

export function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    totalActiveUsers: 42,
    recentPostIds: ["1", "2", "3"],
    ...overrides,
  };
}

// ─── API base URL ───────────────────────────────────────────────────────────
// Absolute URL so Node's global fetch accepts it (and MSW matches on it).
// In a real app this would come from config/env.

export const API_BASE = "https://api.example.com";

// ─── Adapters ───────────────────────────────────────────────────────────────
//
// `userAdapter` — bulk style. One GET carries all ids. Typical of an API
// with `GET /users?id=1&id=2` or `GET /users?ids=1,2` support.
//
// `postAdapter` — fan-out style. No bulk endpoint; the adapter fires N
// parallel single-doc GETs and `Promise.all`s them. Typical of an API that
// only supports `GET /posts/:id`. Fails the batch if any sub-request fails.
//
// `cardStackAdapter` — bulk style, but returns a JSON-API envelope
// (`{ data, included }`). Paired with `jsonApiProcessor`.
//
// The library only requires `find(ids: string[]): Promise<unknown>` —
// everything beyond that is a consumer choice.

export const userAdapter: DocumentAdapter = {
  async find(ids) {
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`${API_BASE}/users?${qs}`);
    if (!res.ok) throw new Error(`/users responded ${res.status}`);
    return res.json();
  },
};

export const postAdapter: DocumentAdapter = {
  async find(ids) {
    return Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`${API_BASE}/posts/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error(`/posts/${id} responded ${res.status}`);
        return res.json();
      }),
    );
  },
};

export const cardStackAdapter: DocumentAdapter = {
  async find(ids) {
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`${API_BASE}/card-stacks?${qs}`);
    if (!res.ok) throw new Error(`/card-stacks responded ${res.status}`);
    return res.json();
  },
};

// `dashboardAdapter` — query-keyed model. Params are structured objects, so
// the adapter receives `Array<DashboardParams>` (raw, not stringified). Fan-out
// style — one GET per params object, returning results in the same order so
// `defaultQueryProcessor` can pair them by position.
export const dashboardAdapter: QueryAdapter<DashboardParams> = {
  async find(paramsList) {
    return Promise.all(
      paramsList.map(async (p) => {
        const qs = new URLSearchParams({
          ws: String(p.workspaceId),
          active: String(p.filters.active),
        });
        const res = await fetch(`${API_BASE}/dashboards?${qs.toString()}`);
        if (!res.ok) throw new Error(`/dashboards responded ${res.status}`);
        return res.json();
      }),
    );
  },
};

// ─── Default MSW handlers ───────────────────────────────────────────────────
// Bulk endpoints for users + card-stacks; per-id endpoint for posts (to
// match the fan-out adapter). Tests can override any handler via
// `server.use(...)` — e.g. to return an error, an empty list, etc.

export const defaultHandlers: Array<HttpHandler> = [
  http.get(`${API_BASE}/users`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll("id");
    return HttpResponse.json(ids.map((id) => makeUser(id)));
  }),
  http.get(`${API_BASE}/posts/:id`, ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json(makePost(id));
  }),
  http.get(`${API_BASE}/card-stacks`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll("id");
    return HttpResponse.json({
      data: ids.map((id) => makeCardStack(id)),
      included: [],
    });
  }),
  http.get(`${API_BASE}/dashboards`, ({ request }) => {
    // Echo back a dashboard whose totalActiveUsers encodes the workspaceId so
    // tests can distinguish responses for different params.
    const ws = Number(new URL(request.url).searchParams.get("ws"));
    return HttpResponse.json(
      makeDashboard({ totalActiveUsers: ws * 10, recentPostIds: [`ws${ws}-post`] }),
    );
  }),
];

// ─── MSW server + request log ───────────────────────────────────────────────
// The test's "fake network". `requests()` returns every fetch the library
// has triggered since the last `clearRequests()`. Adapter tests assert on
// count + URL shape; store/finder tests rely on resolved promises +
// memory state rather than request counts.

export interface RequestRecord {
  method: string;
  url: URL;
}

export const server = setupServer(...defaultHandlers);

const requestLog: Array<RequestRecord> = [];

server.events.on("request:start", ({ request }) => {
  requestLog.push({ method: request.method, url: new URL(request.url) });
});

export function requests(): ReadonlyArray<RequestRecord> {
  return requestLog;
}

export function clearRequests(): void {
  requestLog.length = 0;
}

// ─── Store wiring ───────────────────────────────────────────────────────────
// Store config + non-React store creation for tests. The React-facing API wraps
// the same plain store object via `createSiloContext()`.
// These tests still need a direct store object to exercise the underlying
// document/query methods and finder behavior. The three models exercise the full
// config surface:
//
//   user        — adapter only (uses defaultProcessor implicitly)
//   post        — adapter only, fan-out style (uses defaultProcessor)
//   card-stack  — adapter + custom processor (jsonApiProcessor)
//
// `makeStoreConfig()` is the shape a real app would pass to
// `createSilo(config)`. `initStore()` is the non-React helper
// the tests use to materialize the underlying store API directly.
//
// The optional `overrides` arg is only for tests that need to exercise
// non-default batching knobs; a real consumer would call `initStore()`
// with no args.

export interface StoreOverrides {
  batchWindowMs?: number;
  batchSize?: number;
}

export function makeStoreConfig(
  overrides: StoreOverrides = {},
): SiloConfig<TypeToModel, TypeToQuery> {
  const config: SiloConfig<TypeToModel, TypeToQuery> = {
    models: {
      user: { adapter: userAdapter },
      post: { adapter: postAdapter },
      "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
    },
    queries: {
      dashboard: { adapter: dashboardAdapter },
    },
  };
  if (overrides.batchWindowMs !== undefined) config.batchWindowMs = overrides.batchWindowMs;
  if (overrides.batchSize !== undefined) config.batchSize = overrides.batchSize;
  return config;
}

export function initStore(overrides: StoreOverrides = {}): Silo<TypeToModel, TypeToQuery> {
  return createSilo(makeStoreConfig(overrides));
}

// ─── Timer helpers ──────────────────────────────────────────────────────────

/** Advance past the default 15ms batch window and flush microtasks. */
export async function flushCoalescer(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}
