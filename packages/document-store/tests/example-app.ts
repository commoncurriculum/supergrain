// =============================================================================
// example-app.ts
// =============================================================================
//
// Realistic consumer wiring for @supergrain/document-store. In a real codebase this
// would live at `services/store.ts` (or equivalent): domain models, HTTP
// adapters (real fetch-based), and the one-time Finder + Store composition
// that components import.
//
// Tests use MSW (Mock Service Worker) to intercept the network at the
// fetch layer. Adapters don't know they're being tested — they just call
// fetch() like they would in production. MSW answers with canned documents
// and records every request for assertion.
//
// Config options visible in createApp:
//   - ModelConfig.adapter          (every model)
//   - ModelConfig.processor        (card-stack uses jsonApiProcessor;
//                                   user and post use the default)
//   - FinderConfig.batchWindowMs   (overridable via createApp options)
//   - FinderConfig.batchSize       (overridable via createApp options)
//
// Test lifecycle (put at the top of each test file):
//   beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
//   afterEach(() => { server.resetHandlers(); clearRequests(); });
//   afterAll(() => server.close());
// =============================================================================

import { http, HttpResponse, type HttpHandler } from "msw";
import { setupServer } from "msw/node";
import { vi } from "vitest";

import { DocumentStore, Finder, type DocumentAdapter } from "../src";
import { jsonApiProcessor } from "../src/processors/json-api";

// ─── Domain models ──────────────────────────────────────────────────────────

export interface User {
  id: string;
  type: "user";
  attributes: { firstName: string; lastName: string; email: string };
}

export interface Post {
  id: string;
  type: "post";
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

// ─── Document factories (test-only) ─────────────────────────────────────────

export function makeUser(id: string, overrides: Partial<User["attributes"]> = {}): User {
  return {
    id,
    type: "user",
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
    type: "post",
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

// ─── API base URL ───────────────────────────────────────────────────────────
// Absolute URL so Node's global fetch accepts it (and MSW matches on it).
// In a real app this would come from config/env.

export const API_BASE = "https://api.example.com";

// ─── Adapters ───────────────────────────────────────────────────────────────
// Real fetch-based adapters — the code path a production consumer would
// write. Each adapter owns its own transport (URL, HTTP method, response
// shape). The library only requires `find(ids): Promise<unknown>` —
// everything else is a consumer choice, so in a real codebase you might
// have one adapter talking to a JSON-API service, another to GraphQL,
// and another to a bespoke bulk endpoint.
//
// These three adapters happen to share a convention for simplicity: each
// one GETs its endpoint with repeated `id` query params. That convention
// is inline in each adapter — not extracted into a shared helper — so
// swapping one out doesn't require touching the others.
//
// MSW intercepts the fetch call in tests; in production these would hit
// an actual server.

const userAdapter: DocumentAdapter = {
  async find(ids) {
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`${API_BASE}/users?${qs}`);
    if (!res.ok) throw new Error(`/users responded ${res.status}`);
    return res.json();
  },
};

const postAdapter: DocumentAdapter = {
  async find(ids) {
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`${API_BASE}/posts?${qs}`);
    if (!res.ok) throw new Error(`/posts responded ${res.status}`);
    return res.json();
  },
};

const cardStackAdapter: DocumentAdapter = {
  async find(ids) {
    const qs = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`${API_BASE}/card-stacks?${qs}`);
    if (!res.ok) throw new Error(`/card-stacks responded ${res.status}`);
    return res.json();
  },
};

// ─── Default MSW handlers ───────────────────────────────────────────────────
// One handler per endpoint, each answering id lookups with canned
// documents. Tests can override any handler with `server.use(...)` —
// e.g. to return an error, an empty list, or a specific document.

export const defaultHandlers: Array<HttpHandler> = [
  http.get(`${API_BASE}/users`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll("id");
    return HttpResponse.json(ids.map((id) => makeUser(id)));
  }),
  http.get(`${API_BASE}/posts`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll("id");
    return HttpResponse.json(ids.map((id) => makePost(id)));
  }),
  http.get(`${API_BASE}/card-stacks`, ({ request }) => {
    const ids = new URL(request.url).searchParams.getAll("id");
    return HttpResponse.json({
      data: ids.map((id) => makeCardStack(id)),
      included: [],
    });
  }),
];

// ─── MSW server + request log ───────────────────────────────────────────────
// The test's "fake network". `requests()` returns every fetch the library
// has triggered since the last `clearRequests()`. Tests assert on count
// and pathname; id-correctness is proven via the promise results.

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

// ─── App wiring ─────────────────────────────────────────────────────────────
// The core: Finder + Store composition, done once. In a real app, the
// returned `store` is what every component imports. The three models
// demonstrate the full model-config surface:
//
//   user        — adapter only (uses defaultProcessor implicitly)
//   post        — adapter only (uses defaultProcessor implicitly)
//   card-stack  — adapter + custom processor (jsonApiProcessor)

export interface AppOverrides {
  batchWindowMs?: number;
  batchSize?: number;
}

export function createApp(overrides: AppOverrides = {}) {
  const finder = new Finder<TypeToModel>({
    models: {
      user: { adapter: userAdapter },
      post: { adapter: postAdapter },
      "card-stack": { adapter: cardStackAdapter, processor: jsonApiProcessor },
    },
    batchWindowMs: overrides.batchWindowMs ?? 15,
    batchSize: overrides.batchSize,
  });
  const store = new DocumentStore<TypeToModel>({ finder });
  return { store, finder };
}

export type App = ReturnType<typeof createApp>;

// ─── Timer helpers ──────────────────────────────────────────────────────────

/** Advance past the default 15ms batch window and flush microtasks. */
export async function flushCoalescer(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}
