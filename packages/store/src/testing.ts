import type {
  Doc,
  DocumentAdapter,
  DocumentResponse,
  QueryAdapter,
  QueryResponse,
  ResolvedQueryDef,
} from "./types";

// =============================================================================
// Fake document adapter
// =============================================================================

export interface FakeAdapter<T> {
  /** The `DocumentAdapter<T>` to pass to `createStore`. */
  adapter: DocumentAdapter<T>;
  /** Seed or update the stored attributes for an id. */
  setData(id: string, attributes: T, meta?: Doc<T>["meta"]): void;
  /** Seed the adapter to reject with `error` when `id` is requested. */
  setError(id: string, error: Error): void;
  /** Remove any seeded data or error for an id. */
  clear(id: string): void;
  /** Remove all seeded data and call history. */
  reset(): void;
  /** The ids passed to each `find()` call, in order. */
  readonly calls: ReadonlyArray<readonly string[]>;
  /** Convenience: flatten all seen ids across calls. */
  readonly allRequestedIds: readonly string[];
}

/**
 * Creates an in-memory `DocumentAdapter<T>` suitable for tests.
 *
 * @example
 * ```ts
 * const users = createFakeAdapter<User>({
 *   "1": { firstName: "A", lastName: "B", email: "a@b" },
 * })
 *
 * const store = createStore<Models>({
 *   adapters: { user: users.adapter, post: ... },
 * })
 *
 * const doc = store.findDoc("user", "1")
 * await tick()
 * expect(doc.data?.firstName).toBe("A")
 * expect(users.calls[0]).toEqual(["1"])
 * ```
 */
export function createFakeAdapter<T>(seed: Record<string, T> = {}): FakeAdapter<T> {
  const data = new Map<string, { attributes: T; meta?: Doc<T>["meta"] }>();
  const errors = new Map<string, Error>();
  const calls: Array<readonly string[]> = [];

  for (const [id, attributes] of Object.entries(seed)) {
    data.set(id, { attributes });
  }

  const adapter: DocumentAdapter<T> = {
    find: async (ids) => {
      calls.push([...ids]);

      // Any seeded error among requested ids causes the whole batch to reject,
      // matching the batch-fetch semantics consumers should design for.
      for (const id of ids) {
        const err = errors.get(id);
        if (err) throw err;
      }

      const docs: Doc<T>[] = [];
      for (const id of ids) {
        const entry = data.get(id);
        if (!entry) continue;
        docs.push({
          type: "",
          id,
          attributes: entry.attributes,
          meta: entry.meta,
        });
      }
      const response: DocumentResponse<T> = { data: docs };
      return response;
    },
  };

  return {
    adapter,
    setData(id, attributes, meta) {
      data.set(id, { attributes, meta });
      errors.delete(id);
    },
    setError(id, error) {
      errors.set(id, error);
      data.delete(id);
    },
    clear(id) {
      data.delete(id);
      errors.delete(id);
    },
    reset() {
      data.clear();
      errors.clear();
      calls.length = 0;
    },
    get calls() {
      return calls;
    },
    get allRequestedIds() {
      return calls.flat();
    },
  };
}

// =============================================================================
// Fake query adapter
// =============================================================================

export interface FakeQueryAdapter {
  adapter: QueryAdapter;
  /** Replace the response for subsequent calls. */
  setResponse(response: QueryResponse): void;
  /** Seed the adapter to reject with `error` on next call. */
  setError(error: Error): void;
  /** Clear queued error / reset response to the last `setResponse`. */
  reset(): void;
  /** Every ResolvedQueryDef the adapter has been called with. */
  readonly calls: ReadonlyArray<ResolvedQueryDef>;
}

/**
 * Creates a `QueryAdapter` backed by a configurable in-memory response.
 *
 * @example
 * ```ts
 * const feed = createFakeQueryAdapter({
 *   data: [{ type: "post", id: "10" }],
 *   included: [{ type: "post", id: "10", attributes: { title: "..." } }],
 *   nextOffset: null,
 * })
 *
 * const store = createStore<Models>({
 *   adapters: { ... },
 *   queries: { "activity-feed": feed.adapter },
 * })
 * ```
 */
export function createFakeQueryAdapter(
  initialResponse: QueryResponse = { data: [], included: [], nextOffset: null },
): FakeQueryAdapter {
  let response = initialResponse;
  let queuedError: Error | undefined;
  const calls: ResolvedQueryDef[] = [];

  const adapter: QueryAdapter = {
    fetch: async (def) => {
      calls.push(def);
      if (queuedError) {
        const err = queuedError;
        queuedError = undefined;
        throw err;
      }
      return response;
    },
  };

  return {
    adapter,
    setResponse(next) {
      response = next;
    },
    setError(error) {
      queuedError = error;
    },
    reset() {
      queuedError = undefined;
      calls.length = 0;
    },
    get calls() {
      return calls;
    },
  };
}
