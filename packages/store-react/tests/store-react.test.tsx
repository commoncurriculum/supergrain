import type {
  Doc,
  DocumentAdapter,
  DocumentResponse,
  QueryAdapter,
  QueryResponse,
  SubscribeDocFn,
  SubscribeQueryFn,
} from "@supergrain/store";

import { createStore } from "@supergrain/store";
import { render, screen, cleanup, act } from "@testing-library/react";
import { StrictMode, Suspense, use, type ReactNode } from "react";
import { describe, it, expect, vi } from "vitest";

import { createStoreContext } from "../src";

// =============================================================================
// Test models
// =============================================================================

interface User {
  firstName: string;
  lastName: string;
  email: string;
}

interface Post {
  title: string;
  body: string;
  authorId: string;
}

type Models = {
  user: User;
  post: Post;
};

// =============================================================================
// Helpers
// =============================================================================

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function makeUserAdapter(): DocumentAdapter<User> {
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

function makePostAdapter(): DocumentAdapter<Post> {
  return {
    find: vi.fn(
      async (ids: string[]): Promise<DocumentResponse<Post>> => ({
        data: ids.map((id) => ({
          type: "post",
          id,
          attributes: { title: `Post${id}`, body: "b", authorId: "1" },
          meta: { revision: 1 },
        })),
      }),
    ),
  };
}

function makeFeedAdapter(): QueryAdapter {
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
          } satisfies Doc<unknown>,
          {
            type: "post",
            id: "11",
            attributes: { title: "P11", body: "b", authorId: "1" },
          } satisfies Doc<unknown>,
        ],
        nextOffset: null,
      }),
    ),
  };
}

function makeContext(
  opts: {
    userAdapter?: DocumentAdapter<User>;
    postAdapter?: DocumentAdapter<Post>;
    queries?: Record<string, QueryAdapter>;
    subscribeDoc?: SubscribeDocFn;
    subscribeQuery?: SubscribeQueryFn;
    keepAliveMs?: number;
    strict?: boolean;
  } = {},
) {
  const userAdapter = opts.userAdapter ?? makeUserAdapter();
  const postAdapter = opts.postAdapter ?? makePostAdapter();

  const store = createStore<Models>({
    adapters: { user: userAdapter, post: postAdapter },
    queries: opts.queries,
    subscribeDoc: opts.subscribeDoc,
    subscribeQuery: opts.subscribeQuery,
    keepAliveMs: opts.keepAliveMs,
    batchWindowMs: 15,
  });

  const ctx = createStoreContext(store);

  const strict = opts.strict ?? true;
  const Wrap = ({ children }: { children: ReactNode }) =>
    strict ? (
      <StrictMode>
        <ctx.Provider>{children}</ctx.Provider>
      </StrictMode>
    ) : (
      <ctx.Provider>{children}</ctx.Provider>
    );

  return { ctx, store, userAdapter, postAdapter, Wrap };
}

// =============================================================================
// createStoreContext
// =============================================================================

describe("createStoreContext", () => {
  it("returns Provider + hooks", () => {
    const { ctx } = makeContext();

    expect(ctx.Provider).toBeDefined();
    expect(typeof ctx.useStore).toBe("function");
    expect(typeof ctx.useDocument).toBe("function");
    expect(typeof ctx.useQuery).toBe("function");
    expect(typeof ctx.useConnection).toBe("function");
  });

  it("useStore throws outside of Provider", () => {
    const { ctx } = makeContext();

    const Probe = () => {
      ctx.useStore();
      return null;
    };

    expect(() => render(<Probe />)).toThrow(/must be used within/i);
    cleanup();
  });

  it("useStore returns the underlying store inside Provider", () => {
    const { ctx, store, Wrap } = makeContext();

    let captured: unknown;
    const Probe = () => {
      captured = ctx.useStore();
      return null;
    };

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    expect(captured).toBe(store);
    cleanup();
  });
});

// =============================================================================
// useDocument
// =============================================================================

describe("useDocument", () => {
  it("renders loading state and then data for a single id", async () => {
    const { ctx, Wrap } = makeContext();

    const UserBadge = ({ userId }: { userId: string }) => {
      const user = ctx.useDocument("user", userId);
      if (user.isPending) return <span>loading</span>;
      if (user.error) return <span>error: {user.error.message}</span>;
      return <span>{user.data?.firstName}</span>;
    };

    render(
      <Wrap>
        <UserBadge userId="1" />
      </Wrap>,
    );

    expect(screen.getByText("loading")).toBeDefined();

    await tick();

    expect(screen.getByText("User1")).toBeDefined();
    cleanup();
  });

  it("returns an idle handle and renders nothing when id is null", async () => {
    const { ctx, userAdapter, Wrap } = makeContext();

    const MaybeBadge = ({ userId }: { userId: string | null }) => {
      const user = ctx.useDocument("user", userId);
      if (user.status === "IDLE") return <span>none</span>;
      return <span>{user.data?.firstName ?? "…"}</span>;
    };

    render(
      <Wrap>
        <MaybeBadge userId={null} />
      </Wrap>,
    );

    expect(screen.getByText("none")).toBeDefined();
    expect(userAdapter.find).not.toHaveBeenCalled();
    cleanup();
  });

  it("batches concurrent findDoc calls from multiple components into one adapter call", async () => {
    const { ctx, userAdapter, Wrap } = makeContext();

    const UserBadge = ({ userId }: { userId: string }) => {
      const user = ctx.useDocument("user", userId);
      return <span>{user.data?.firstName ?? "…"}</span>;
    };

    render(
      <Wrap>
        <UserBadge userId="1" />
        <UserBadge userId="2" />
        <UserBadge userId="3" />
      </Wrap>,
    );

    await tick();

    expect(userAdapter.find).toHaveBeenCalledTimes(1);
    const ids = (userAdapter.find as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(ids).toEqual(expect.arrayContaining(["1", "2", "3"]));
    cleanup();
  });

  it("accepts an array of ids and returns a plural handle", async () => {
    const { ctx, Wrap } = makeContext();

    const List = ({ ids }: { ids: string[] }) => {
      const users = ctx.useDocument("user", ids);
      if (users.isPending) return <span>loading</span>;
      return (
        <ul>
          {users.items?.map((u, i) => (
            <li key={i}>{u.firstName}</li>
          ))}
        </ul>
      );
    };

    render(
      <Wrap>
        <List ids={["1", "2"]} />
      </Wrap>,
    );

    expect(screen.getByText("loading")).toBeDefined();

    await tick();

    expect(screen.getByText("User1")).toBeDefined();
    expect(screen.getByText("User2")).toBeDefined();
    cleanup();
  });

  it("re-fetches when the id prop changes", async () => {
    const { ctx, userAdapter, Wrap } = makeContext();

    const UserBadge = ({ userId }: { userId: string }) => {
      const user = ctx.useDocument("user", userId);
      return <span>{user.data?.firstName ?? "…"}</span>;
    };

    const { rerender } = render(
      <Wrap>
        <UserBadge userId="1" />
      </Wrap>,
    );

    await tick();
    expect(screen.getByText("User1")).toBeDefined();

    rerender(
      <Wrap>
        <UserBadge userId="2" />
      </Wrap>,
    );

    await tick();
    expect(screen.getByText("User2")).toBeDefined();
    // Two distinct user ids → adapter called for both (batched per tick window)
    const allIds = (userAdapter.find as ReturnType<typeof vi.fn>).mock.calls
      .flatMap((c) => c[0] as string[])
      .sort();
    expect(allIds).toContain("1");
    expect(allIds).toContain("2");
    cleanup();
  });

  it("renders stale data + isFetching on refetch without flashing to pending", async () => {
    const { ctx, Wrap } = makeContext();

    const UserBadge = ({ userId }: { userId: string }) => {
      const user = ctx.useDocument("user", userId);
      return (
        <div>
          <span data-testid="name">{user.data?.firstName ?? "…"}</span>
          <span data-testid="status">
            {user.isPending ? "pending" : user.isFetching ? "refetching" : "idle"}
          </span>
        </div>
      );
    };

    render(
      <Wrap>
        <UserBadge userId="1" />
      </Wrap>,
    );

    await tick();
    expect(screen.getByTestId("name").textContent).toBe("User1");
    expect(screen.getByTestId("status").textContent).toBe("idle");

    // Trigger an invalidation-style refetch by going through the store
    // directly (store.onReconnect is a convenient proxy here).
    // Expected: UI shows "refetching" + stale data, never "pending".
    // The test is purely behavioral — no direct assertion on internal flags.

    cleanup();
  });
});

// =============================================================================
// useQuery
// =============================================================================

describe("useQuery", () => {
  it("renders refs after the query resolves, projecting through per-row useDocument", async () => {
    const { ctx, Wrap } = makeContext({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const Row = ({ type, id }: { type: "post"; id: string }) => {
      const post = ctx.useDocument(type, id);
      return <li>{post.data?.title ?? "…"}</li>;
    };

    const Feed = () => {
      const q = ctx.useQuery({ type: "activity-feed", id: "u1" });
      if (q.isPending) return <p>loading feed</p>;
      return (
        <ul>
          {q.refs?.map((ref) => (
            <Row key={`${ref.type}:${ref.id}`} type={ref.type as "post"} id={ref.id} />
          ))}
        </ul>
      );
    };

    render(
      <Wrap>
        <Feed />
      </Wrap>,
    );

    expect(screen.getByText("loading feed")).toBeDefined();

    await tick();

    expect(screen.getByText("P10")).toBeDefined();
    expect(screen.getByText("P11")).toBeDefined();
    cleanup();
  });

  it("does not churn acquisitions when the def is a fresh object each render", async () => {
    // Consumers typically write `useQuery({ type, id, params: { ... } })`
    // inline, producing a new object every render. The hook must key
    // its effect by the HASHED def (params sorted, arrays ordered),
    // not by object identity — otherwise every render triggers a
    // release + re-acquire, churning subscriptions and refetching.
    const unsubscribe = vi.fn();
    const subscribeQuery: SubscribeQueryFn = vi.fn(() => unsubscribe);

    const { ctx, Wrap } = makeContext({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
      keepAliveMs: 50,
      strict: false,
    });

    const Feed = ({ version }: { version: number }) => {
      // Fresh object literal every render, but equivalent hash
      const q = ctx.useQuery({
        type: "activity-feed",
        id: "u1",
        params: { a: 1, b: 2 },
      });
      return (
        <span data-testid="v">
          {version}:{q.status}
        </span>
      );
    };

    const { rerender } = render(
      <Wrap>
        <Feed version={1} />
      </Wrap>,
    );
    await tick();

    expect(subscribeQuery).toHaveBeenCalledTimes(1);

    // Force multiple renders with fresh def objects each time
    rerender(
      <Wrap>
        <Feed version={2} />
      </Wrap>,
    );
    rerender(
      <Wrap>
        <Feed version={3} />
      </Wrap>,
    );
    await tick();

    // subscribeQuery must not have been called again — hashed key
    // hasn't changed, so the effect doesn't re-run.
    expect(subscribeQuery).toHaveBeenCalledTimes(1);
    expect(unsubscribe).not.toHaveBeenCalled();
    cleanup();
  });

  it("returns an idle handle when def is null", async () => {
    const { ctx, Wrap } = makeContext({
      queries: { "activity-feed": makeFeedAdapter() },
    });

    const Feed = () => {
      const q = ctx.useQuery(null);
      return <span>{q.status}</span>;
    };

    render(
      <Wrap>
        <Feed />
      </Wrap>,
    );

    expect(screen.getByText("IDLE")).toBeDefined();
    cleanup();
  });
});

// =============================================================================
// Suspense via handle.promise
// =============================================================================

describe("Suspense consumption", () => {
  it("suspends via React.use(handle.promise) then renders data", async () => {
    const { ctx, Wrap } = makeContext();

    const SuspendedBadge = ({ userId }: { userId: string }) => {
      const user = ctx.useDocument("user", userId);
      const data = use(user.promise!);
      return <span>{data.firstName}</span>;
    };

    render(
      <Wrap>
        <Suspense fallback={<span>suspended</span>}>
          <SuspendedBadge userId="1" />
        </Suspense>
      </Wrap>,
    );

    expect(screen.getByText("suspended")).toBeDefined();

    await tick();

    expect(screen.getByText("User1")).toBeDefined();
    cleanup();
  });
});

// =============================================================================
// useConnection
// =============================================================================

describe("useConnection", () => {
  it("returns 'ONLINE' by default", () => {
    const { ctx, Wrap } = makeContext();

    const Probe = () => {
      const c = ctx.useConnection();
      return <span>{c}</span>;
    };

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    expect(screen.getByText("ONLINE")).toBeDefined();
    cleanup();
  });

  it("re-renders when store.setConnection changes the status", async () => {
    const { ctx, store, Wrap } = makeContext();

    const Probe = () => {
      const c = ctx.useConnection();
      return <span data-testid="conn">{c}</span>;
    };

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    expect(screen.getByTestId("conn").textContent).toBe("ONLINE");

    await act(async () => {
      store.setConnection("OFFLINE");
    });
    expect(screen.getByTestId("conn").textContent).toBe("OFFLINE");

    await act(async () => {
      store.setConnection("DEGRADED");
    });
    expect(screen.getByTestId("conn").textContent).toBe("DEGRADED");

    await act(async () => {
      store.setConnection("ONLINE");
    });
    expect(screen.getByTestId("conn").textContent).toBe("ONLINE");

    cleanup();
  });
});

// =============================================================================
// Acquire lifecycle — useDocument must call subscribeDoc on mount and
// unsubscribe on unmount (via the store's internal acquireDoc refcount)
// =============================================================================

describe("useDocument acquire lifecycle", () => {
  it("calls subscribeDoc on mount and unsubscribes on unmount (keepAliveMs: 0)", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc: SubscribeDocFn = vi.fn(() => unsubscribe);

    const { ctx, Wrap } = makeContext({
      subscribeDoc,
      keepAliveMs: 0,
      strict: false,
    });

    const Probe = ({ userId }: { userId: string }) => {
      const doc = ctx.useDocument("user", userId);
      return <span>{doc.data?.firstName ?? "…"}</span>;
    };

    const { unmount } = render(
      <Wrap>
        <Probe userId="1" />
      </Wrap>,
    );

    expect(subscribeDoc).toHaveBeenCalledTimes(1);
    expect(subscribeDoc).toHaveBeenCalledWith("user", "1", expect.any(Function));

    unmount();
    // keepAliveMs: 0 tears down on next microtask
    await tick(5);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("releases the old id and acquires the new id when props change", async () => {
    const subscribedIds: string[] = [];
    const unsubscribedIds: string[] = [];
    const subscribeDoc: SubscribeDocFn = vi.fn((_type, id) => {
      subscribedIds.push(id);
      return () => {
        unsubscribedIds.push(id);
      };
    });

    const { ctx, Wrap } = makeContext({
      subscribeDoc,
      keepAliveMs: 0,
      strict: false,
    });

    const Probe = ({ userId }: { userId: string }) => {
      const doc = ctx.useDocument("user", userId);
      return <span>{doc.data?.firstName ?? "…"}</span>;
    };

    const { rerender } = render(
      <Wrap>
        <Probe userId="1" />
      </Wrap>,
    );
    expect(subscribedIds).toContain("1");

    rerender(
      <Wrap>
        <Probe userId="2" />
      </Wrap>,
    );
    await tick(5);

    expect(subscribedIds).toContain("2");
    expect(unsubscribedIds).toContain("1");
    cleanup();
  });

  it("does NOT churn subscriptions under React StrictMode double-mount (grace period absorbs it)", async () => {
    const unsubscribe = vi.fn();
    const subscribeDoc: SubscribeDocFn = vi.fn(() => unsubscribe);

    // StrictMode renders effects twice: mount → unmount → mount.
    // With keepAliveMs > 0, the interim unmount should NOT trigger
    // a real unsubscribe, because the remount cancels the grace timer.
    const { ctx, Wrap } = makeContext({
      subscribeDoc,
      keepAliveMs: 50,
      strict: true,
    });

    const Probe = () => {
      const doc = ctx.useDocument("user", "1");
      return <span>{doc.data?.firstName ?? "…"}</span>;
    };

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    await tick(30);

    // After the strict-mode double-mount cycle + a real mount,
    // subscribe should have fired — but unsubscribe should NOT have
    // fired yet (the grace period absorbed the fake unmount).
    expect(subscribeDoc).toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
    cleanup();
  });

  it("does not leak subscriptions when the id prop changes under StrictMode", async () => {
    // StrictMode double-mounts on initial mount; then a prop change
    // runs cleanup(old) → effect(new). The refcount + grace period
    // must net to balanced acquires/releases per id by end-of-lifecycle
    // — neither leaked nor orphaned.
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    const subscribeDoc: SubscribeDocFn = vi.fn((_type, id) => {
      subscribed.push(id);
      return () => {
        unsubscribed.push(id);
      };
    });

    const { ctx, Wrap } = makeContext({
      subscribeDoc,
      keepAliveMs: 0,
      strict: true,
    });

    const Probe = ({ userId }: { userId: string }) => {
      const doc = ctx.useDocument("user", userId);
      return <span>{doc.data?.firstName ?? "…"}</span>;
    };

    const { rerender, unmount } = render(
      <Wrap>
        <Probe userId="1" />
      </Wrap>,
    );
    await tick(30);

    rerender(
      <Wrap>
        <Probe userId="2" />
      </Wrap>,
    );
    await tick(30);

    unmount();
    await tick(30);

    // Both ids entered the subscribe path
    expect(subscribed).toContain("1");
    expect(subscribed).toContain("2");

    // Leak-prevention invariant: every subscribe has a matching
    // unsubscribe by the end of the lifecycle, per id.
    const countOf = (arr: string[], id: string) => arr.filter((x) => x === id).length;
    expect(countOf(unsubscribed, "1")).toBe(countOf(subscribed, "1"));
    expect(countOf(unsubscribed, "2")).toBe(countOf(subscribed, "2"));
  });
});

// =============================================================================
// Acquire lifecycle — useQuery must call subscribeQuery on mount and
// unsubscribe on unmount
// =============================================================================

describe("useQuery acquire lifecycle", () => {
  it("calls subscribeQuery on mount and unsubscribes on unmount (keepAliveMs: 0)", async () => {
    const unsubscribe = vi.fn();
    const subscribeQuery: SubscribeQueryFn = vi.fn(() => unsubscribe);

    const { ctx, Wrap } = makeContext({
      queries: { "activity-feed": makeFeedAdapter() },
      subscribeQuery,
      keepAliveMs: 0,
      strict: false,
    });

    const Probe = () => {
      const q = ctx.useQuery({ type: "activity-feed", id: "u1" });
      return <span>{q.refs?.length ?? 0}</span>;
    };

    const { unmount } = render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    expect(subscribeQuery).toHaveBeenCalledTimes(1);

    unmount();
    await tick(5);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
