import type {
  DocumentAdapter,
  DocumentResponse,
  QueryAdapter,
  QueryResponse,
  StoreConfig,
} from "../src";

import { vi } from "vitest";

import { createStore } from "../src";

// =============================================================================
// Shared model types
// =============================================================================

export interface User {
  firstName: string;
  lastName: string;
  email: string;
}

export interface Post {
  title: string;
  body: string;
  authorId: string;
}

export type Models = {
  user: User;
  post: Post;
};

// =============================================================================
// Adapter factories
// =============================================================================

/**
 * Default user adapter that echoes back `User${id}` for any requested id.
 * Every returned doc has `meta: { revision: 1 }`.
 */
export function makeUserAdapter(): DocumentAdapter<User> {
  return {
    find: vi.fn(
      async (ids: string[]): Promise<DocumentResponse<User>> => ({
        data: ids.map((id) => ({
          type: "user",
          id,
          attributes: {
            firstName: `User${id}`,
            lastName: "Test",
            email: `user${id}@example.com`,
          },
          meta: { revision: 1 },
        })),
      }),
    ),
  };
}

export function makePostAdapter(): DocumentAdapter<Post> {
  return {
    find: vi.fn(
      async (ids: string[]): Promise<DocumentResponse<Post>> => ({
        data: ids.map((id) => ({
          type: "post",
          id,
          attributes: {
            title: `Post${id}`,
            body: "body",
            authorId: "1",
          },
          meta: { revision: 1 },
        })),
      }),
    ),
  };
}

/** A QueryAdapter that returns two post refs with matching `included` docs. */
export function makeFeedAdapter(): QueryAdapter {
  return {
    fetch: vi.fn(
      async (): Promise<QueryResponse> => ({
        data: [
          { type: "post", id: "10" },
          { type: "post", id: "11" },
        ],
        included: [
          {
            type: "post",
            id: "10",
            attributes: { title: "P10", body: "b", authorId: "1" },
          },
          {
            type: "post",
            id: "11",
            attributes: { title: "P11", body: "b", authorId: "1" },
          },
        ],
        nextOffset: null,
      }),
    ),
  };
}

// =============================================================================
// Store factory
// =============================================================================

/**
 * Builds a store with standard user/post adapters and a 15ms batch window.
 * Override any StoreConfig field via `overrides`.
 */
export function makeStore(overrides: Partial<StoreConfig<Models>> = {}) {
  const userAdapter = makeUserAdapter();
  const postAdapter = makePostAdapter();

  const store = createStore<Models>({
    adapters: { user: userAdapter, post: postAdapter },
    batchWindowMs: 15,
    ...overrides,
  });

  return { store, userAdapter, postAdapter };
}

// =============================================================================
// Timer helpers (fake timers required — call vi.useFakeTimers() in beforeEach)
// =============================================================================

/**
 * Advance past the 15ms coalescer batch window and flush any resulting
 * async work (adapter promises, post-fetch cache writes, event emissions).
 *
 * Use inside a test file that sets up `vi.useFakeTimers()` in `beforeEach`.
 */
export async function flushCoalescer(): Promise<void> {
  await vi.advanceTimersByTimeAsync(20);
}

/**
 * Advance `ms` milliseconds and flush microtasks. Useful for testing the
 * acquire grace period boundary.
 */
export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Flush all pending timers AND microtasks. */
export async function flushAll(): Promise<void> {
  await vi.runAllTimersAsync();
}
