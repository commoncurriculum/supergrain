import { tracked } from "@supergrain/kernel/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Effect, Schedule } from "effect";
import { type ReactNode, StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AdapterError,
  createDocumentStore,
  type DocumentStore,
  type DocumentStoreConfig,
  type QueryAdapter,
  type DocumentAdapter,
} from "../../src";
import { createDocumentStoreContext } from "../../src/react";

interface User {
  id: string;
  attributes: { firstName: string; lastName: string; email: string };
}

interface Dashboard {
  totalActiveUsers: number;
  recentPostIds: Array<string>;
}

interface DashboardParams {
  workspaceId: number;
  filters: { active: boolean };
}

type TypeToModel = {
  user: User;
};

type TypeToQuery = {
  dashboard: { params: DashboardParams; result: Dashboard };
};

function makeUser(id: string, overrides: Partial<User["attributes"]> = {}): User {
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

function makeDashboard(workspaceId: number): Dashboard {
  return {
    totalActiveUsers: workspaceId * 10,
    recentPostIds: [`ws${workspaceId}-post`],
  };
}

let usersShouldFail = false;
let dashboardsShouldFail = false;

beforeEach(() => {
  usersShouldFail = false;
  dashboardsShouldFail = false;
});

afterEach(() => {
  cleanup();
});

// =============================================================================
// Per-file isolated context via the factory, typed for TypeToModel (so the
// hooks don't rely on global TypeRegistry augmentation).
// =============================================================================

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const {
  Provider,
  useDocument,
  useDocumentsIndividually,
  useDocumentsTogether,
  useDocumentStore,
  useQuery,
} = createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();

const userAdapter: DocumentAdapter = {
  find: (ids) =>
    Effect.tryPromise({
      try: async () => {
        if (usersShouldFail) {
          throw new Error("/users responded 500");
        }
        return ids.map((id) => makeUser(id));
      },
      catch: (cause) => new AdapterError({ type: "user", keys: ids, cause }),
    }),
};

const dashboardAdapter: QueryAdapter<DashboardParams> = {
  find: (paramsList) =>
    Effect.tryPromise({
      try: async () => {
        if (dashboardsShouldFail) {
          throw new Error("/dashboards responded 500");
        }
        return paramsList.map((params) => makeDashboard(params.workspaceId));
      },
      catch: (cause) => new AdapterError({ type: "dashboard", keys: [], cause }),
    }),
};

function makeStoreConfig(): DocumentStoreConfig<TypeToModel, TypeToQuery> {
  return {
    models: {
      user: { adapter: userAdapter },
    },
    queries: {
      dashboard: { adapter: dashboardAdapter },
    },
    // Disable the built-in fibonacci default retry so error-state tests surface
    // immediately rather than retrying forever.
    retry: Schedule.recurs(0),
  };
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <Provider config={makeStoreConfig()}>{children}</Provider>
    </StrictMode>
  );
}

// Seed components only WRITE to the store (no reactive reads for rendering),
// so they are plain components — not `tracked`. Wrapping a write-only,
// insert-during-render component in `tracked` would subscribe its render
// effect to the very handle fields the insert mutates, self-triggering an
// infinite re-render loop. (See note in json-api.test.tsx Seed* helpers.)
function SeedUser({ user }: { user: User }) {
  const store = useDocumentStore();
  store.insertDocument("user", user);
  return null;
}

// =============================================================================
// Realistic components the tests render — same shape a consumer would write.
// =============================================================================

const UserBadge = tracked(function UserBadge({ userId }: { userId: string | null | undefined }) {
  const handle = useDocument("user", userId);
  if (handle.value === undefined && !handle.isFetching && handle.error === undefined)
    return <span>no user</span>;
  if (handle.value === undefined && handle.isFetching) return <span>loading</span>;
  if (handle.error !== undefined) return <span>error: {handle.error.message}</span>;
  return <span>{handle.value !== undefined ? handle.value.attributes.firstName : null}</span>;
});

const UserList = tracked(function UserList({ ids }: { ids: ReadonlyArray<string> }) {
  const store = useDocumentStore();
  const handles = ids.map((id) => store.find("user", id));

  if (handles.length === 0) return <span>no users</span>;
  if (handles.some((handle) => handle.error !== undefined)) return <span>error</span>;
  if (handles.some((handle) => handle.value === undefined && handle.isFetching))
    return <span>loading</span>;

  return (
    <ul>
      {handles.map((handle) =>
        handle.value !== undefined ? (
          <li key={handle.value.id}>{handle.value.attributes.firstName}</li>
        ) : null,
      )}
    </ul>
  );
});

// Individually: one handle per id, each rendering its own loading/error/value.
const UserRosterIndividually = tracked(function UserRosterIndividually({
  ids,
}: {
  ids: ReadonlyArray<string> | null;
}) {
  const idList = ids == null ? [] : [...ids];
  const handles = useDocumentsIndividually("user", ids == null ? null : idList);

  if (handles.length === 0) return <span>no roster</span>;

  return (
    <ul>
      {handles.map((handle, i) => (
        // Key by the requested id (handles are in id order) so a row stays with
        // its document across reorder/insert/remove — never the array index.
        <li key={idList[i]}>
          {handle.status === "pending"
            ? "loading"
            : handle.status === "error"
              ? "error"
              : handle.value.attributes.firstName}
        </li>
      ))}
    </ul>
  );
});

// Together: the all-or-nothing batch — idle for no ids, loading until every id
// is in, an error banner if any fails, else the full list.
const UserRosterTogether = tracked(function UserRosterTogether({
  ids,
}: {
  ids: ReadonlyArray<string> | null;
}) {
  const docs = useDocumentsTogether("user", ids == null ? null : [...ids]);

  if (ids == null || ids.length === 0) return <span>no roster</span>;
  if (docs.status === "error") return <span>error</span>;
  if (docs.status === "pending") return <span>loading</span>;

  return (
    <ul>
      {docs.value!.map((user) => (
        <li key={user.id}>{user.attributes.firstName}</li>
      ))}
    </ul>
  );
});

const DashboardView = tracked(function DashboardView({
  workspaceId,
}: {
  workspaceId: number | null;
}) {
  const handle = useQuery(
    "dashboard",
    workspaceId == null ? null : { workspaceId, filters: { active: true } },
  );
  if (handle.value === undefined && !handle.isFetching && handle.error === undefined)
    return <span>no dashboard</span>;
  if (handle.value === undefined && handle.isFetching) return <span>loading dashboard</span>;
  if (handle.error !== undefined) return <span>error: {handle.error.message}</span>;
  return <span>users: {handle.value !== undefined ? handle.value.totalActiveUsers : null}</span>;
});

// =============================================================================
// Provider — hooks work inside it, throw outside it.
// =============================================================================

describe("createDocumentStoreContext Provider", () => {
  it("makes the store available to descendants — useDocument fetches and renders", async () => {
    render(
      <Wrap>
        <UserBadge userId="1" />
      </Wrap>,
    );

    expect(screen.getByText("loading")).toBeDefined();

    // Poll for the loaded state — a fixed sleep races the real-timer fetch
    // and flakes under parallel-suite CPU load.
    expect(await screen.findByText("User1", undefined, { timeout: 5000 })).toBeDefined();
  });

  it("throws when hooks are used outside a Provider", () => {
    expect(() => render(<UserBadge userId="1" />)).toThrow(/must be used within/i);
  });
});

// =============================================================================
// useDocument
// =============================================================================

describe("useDocument", () => {
  it("returns an idle handle when id is null", () => {
    render(
      <Wrap>
        <UserBadge userId={null} />
      </Wrap>,
    );

    expect(screen.getByText("no user")).toBeDefined();
  });

  it("shows cached data immediately with no loading state (memory-first path)", () => {
    render(
      <Wrap>
        <SeedUser user={makeUser("1", { firstName: "Alice" })} />
        <UserBadge userId="1" />
      </Wrap>,
    );

    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
  });
});

// =============================================================================
// useDocumentStore composition over many documents
// =============================================================================

describe("useDocumentStore + find composition", () => {
  it("renders loading then the full list for a batch of ids", async () => {
    render(
      <Wrap>
        <UserList ids={["1", "2", "3"]} />
      </Wrap>,
    );

    expect(screen.getByText("loading")).toBeDefined();

    // One chunked fetch commits all three in one batch — poll for the first
    // and the rest are synchronously present.
    expect(await screen.findByText("User1", undefined, { timeout: 5000 })).toBeDefined();
    expect(screen.getByText("User2")).toBeDefined();
    expect(screen.getByText("User3")).toBeDefined();
  });

  it("returns an idle handle for an empty ids array", () => {
    render(
      <Wrap>
        <UserList ids={[]} />
      </Wrap>,
    );

    expect(screen.getByText("no users")).toBeDefined();
  });

  it("surfaces a batch error when the endpoint fails", async () => {
    usersShouldFail = true;

    render(
      <Wrap>
        <UserList ids={["1", "2"]} />
      </Wrap>,
    );

    // Wait for the failure to settle rather than a fixed delay: the fetch fires
    // a per-attempt `Retrying` notification before the terminal `error`, so poll
    // for the end state instead of racing a single tick.
    expect(await screen.findByText("error")).toBeDefined();
  });
});

// =============================================================================
// useDocumentsIndividually — one handle per id, each settling on its own. A
// pure reactive read; the returned array is held stable across renders (ref)
// while the ids are unchanged.
// =============================================================================

describe("useDocumentsIndividually", () => {
  it("renders 'no roster' when ids is null", () => {
    render(
      <Wrap>
        <UserRosterIndividually ids={null} />
      </Wrap>,
    );
    expect(screen.getByText("no roster")).toBeDefined();
  });

  it("renders 'no roster' for an empty ids array", () => {
    render(
      <Wrap>
        <UserRosterIndividually ids={[]} />
      </Wrap>,
    );
    expect(screen.getByText("no roster")).toBeDefined();
  });

  it("renders each row loading, then each value as its handle settles", async () => {
    render(
      <Wrap>
        <UserRosterIndividually ids={["1", "2", "3"]} />
      </Wrap>,
    );

    expect(screen.getAllByText("loading")).toHaveLength(3);

    expect(await screen.findByText("User1", undefined, { timeout: 5000 })).toBeDefined();
    expect(screen.getByText("User2")).toBeDefined();
    expect(screen.getByText("User3")).toBeDefined();
  });

  it("renders cached values immediately with no loading rows", () => {
    render(
      <Wrap>
        <SeedUser user={makeUser("1", { firstName: "Ada" })} />
        <SeedUser user={makeUser("2", { firstName: "Grace" })} />
        <UserRosterIndividually ids={["1", "2"]} />
      </Wrap>,
    );

    expect(screen.getByText("Ada")).toBeDefined();
    expect(screen.getByText("Grace")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("keeps a stable array identity across re-renders while ids are unchanged", () => {
    const seen: Array<unknown> = [];

    const Probe = tracked(function Probe() {
      const [, force] = useState(0);
      const handles = useDocumentsIndividually("user", ["1", "2"]);
      seen.push(handles);
      return (
        <button type="button" onClick={() => force((n) => n + 1)}>
          rerender
        </button>
      );
    });

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    fireEvent.click(screen.getByText("rerender"));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((h) => h === seen[0])).toBe(true);
  });

  it("hands back a fresh array when the ids change to a same-length, different set", () => {
    // Same length (2 → 2), all different handles — so the stability check has to
    // compare elements, not just length.
    const seen: Array<unknown> = [];

    const Probe = tracked(function Probe({ ids }: { ids: Array<string> }) {
      seen.push(useDocumentsIndividually("user", ids));
      return null;
    });

    const { rerender } = render(
      <Wrap>
        <Probe ids={["1", "2"]} />
      </Wrap>,
    );
    rerender(
      <Wrap>
        <Probe ids={["3", "4"]} />
      </Wrap>,
    );

    expect(seen[0]).not.toBe(seen.at(-1));
  });
});

// =============================================================================
// useDocumentsTogether — the all-or-nothing batch hook. Pure reactive read; the
// returned handle is held stable across renders (ref) while the ids are
// unchanged, so use()/memoization see a stable object + promise.
// =============================================================================

describe("useDocumentsTogether", () => {
  it("renders 'no roster' when ids is null", () => {
    render(
      <Wrap>
        <UserRosterTogether ids={null} />
      </Wrap>,
    );
    expect(screen.getByText("no roster")).toBeDefined();
  });

  it("renders 'no roster' for an empty ids array", () => {
    render(
      <Wrap>
        <UserRosterTogether ids={[]} />
      </Wrap>,
    );
    expect(screen.getByText("no roster")).toBeDefined();
  });

  it("renders loading until every id is in, then the full roster in id order", async () => {
    render(
      <Wrap>
        <UserRosterTogether ids={["1", "2", "3"]} />
      </Wrap>,
    );

    expect(screen.getByText("loading")).toBeDefined();

    expect(await screen.findByText("User1", undefined, { timeout: 5000 })).toBeDefined();
    expect(screen.getByText("User2")).toBeDefined();
    expect(screen.getByText("User3")).toBeDefined();
  });

  it("renders a fully-cached batch immediately with no loading state", () => {
    render(
      <Wrap>
        <SeedUser user={makeUser("1", { firstName: "Ada" })} />
        <SeedUser user={makeUser("2", { firstName: "Grace" })} />
        <UserRosterTogether ids={["1", "2"]} />
      </Wrap>,
    );

    expect(screen.getByText("Ada")).toBeDefined();
    expect(screen.getByText("Grace")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("surfaces a failing id as the batch error state", async () => {
    usersShouldFail = true;

    render(
      <Wrap>
        <UserRosterTogether ids={["1", "2"]} />
      </Wrap>,
    );

    expect(await screen.findByText("error")).toBeDefined();
  });

  it("keeps a stable handle identity across re-renders while ids are unchanged", () => {
    const seen: Array<unknown> = [];

    const Probe = tracked(function Probe() {
      const [, force] = useState(0);
      seen.push(useDocumentsTogether("user", ["1", "2"]));
      return (
        <button type="button" onClick={() => force((n) => n + 1)}>
          rerender
        </button>
      );
    });

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    fireEvent.click(screen.getByText("rerender"));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((h) => h === seen[0])).toBe(true);
  });

  it("hands back a fresh handle when the ids change", () => {
    const seen: Array<unknown> = [];

    const Probe = tracked(function Probe({ ids }: { ids: Array<string> }) {
      seen.push(useDocumentsTogether("user", ids));
      return null;
    });

    const { rerender } = render(
      <Wrap>
        <Probe ids={["1", "2"]} />
      </Wrap>,
    );
    rerender(
      <Wrap>
        <Probe ids={["1", "2", "3"]} />
      </Wrap>,
    );

    expect(seen[0]).not.toBe(seen.at(-1));
  });
});

// =============================================================================
// useDocumentStore — the imperative escape hatch (e.g. for socket pushes,
// "save" buttons, clearMemory on logout).
// =============================================================================

describe("useDocumentStore", () => {
  it("exposes the store for imperative writes (e.g. socket push → insertDocument)", () => {
    const PushSimulator = tracked(function PushSimulator({ user }: { user: User }) {
      // A component that simulates an external source (websocket, admin tool,
      // etc.) writing directly to the store. Real apps do this inside effects
      // that subscribe to transport events.
      const store = useDocumentStore();
      return (
        <button type="button" onClick={() => store.insertDocument("user", user)}>
          simulate push
        </button>
      );
    });

    render(
      <Wrap>
        <PushSimulator user={makeUser("99", { firstName: "Pushed" })} />
        <UserBadge userId="99" />
      </Wrap>,
    );

    // UserBadge fired a fetch for id 99 on mount.
    expect(screen.getByText("loading")).toBeDefined();

    // External "push" inserts before the fetch lands. UserBadge picks it up
    // via the handle's memory-backed reactive data.
    fireEvent.click(screen.getByText("simulate push"));

    expect(screen.getByText("Pushed")).toBeDefined();
  });
});

// =============================================================================
// useQuery
// =============================================================================

describe("useQuery", () => {
  it("fetches a query via the adapter and renders loading → data", async () => {
    render(
      <Wrap>
        <DashboardView workspaceId={7} />
      </Wrap>,
    );

    expect(screen.getByText("loading dashboard")).toBeDefined();

    // dashboard MSW handler encodes workspaceId * 10 into totalActiveUsers.
    expect(await screen.findByText("users: 70", undefined, { timeout: 5000 })).toBeDefined();
  });

  it("returns an idle handle when params is null", () => {
    render(
      <Wrap>
        <DashboardView workspaceId={null} />
      </Wrap>,
    );

    expect(screen.getByText("no dashboard")).toBeDefined();
  });

  it("surfaces an adapter error as error state", async () => {
    dashboardsShouldFail = true;

    render(
      <Wrap>
        <DashboardView workspaceId={7} />
      </Wrap>,
    );

    // Poll for the settled error state (see note above on the per-attempt
    // `Retrying` notification) rather than racing a single tick.
    expect(await screen.findByText(/error:/)).toBeDefined();
  });
});

// =============================================================================
// Factory isolation — two factory instances keep their stores separate.
// =============================================================================

describe("createDocumentStoreContext isolation", () => {
  it("two independent stores render their own data side-by-side", () => {
    const tenantA = createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();
    const tenantB = createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();

    // Write-only seeds — plain components, not `tracked` (see SeedUser note).
    function SeedA() {
      const store = tenantA.useDocumentStore();
      store.insertDocument("user", makeUser("1", { firstName: "AliceA" }));
      return null;
    }

    function SeedB() {
      const store = tenantB.useDocumentStore();
      store.insertDocument("user", makeUser("1", { firstName: "BobB" }));
      return null;
    }

    const UserFromA = tracked(function UserFromA() {
      const handle = tenantA.useDocument("user", "1");
      return (
        <span data-testid="tenant-a">
          {handle.value !== undefined ? handle.value.attributes.firstName : "—"}
        </span>
      );
    });
    const UserFromB = tracked(function UserFromB() {
      const handle = tenantB.useDocument("user", "1");
      return (
        <span data-testid="tenant-b">
          {handle.value !== undefined ? handle.value.attributes.firstName : "—"}
        </span>
      );
    });

    render(
      <>
        <tenantA.Provider config={makeStoreConfig()}>
          <SeedA />
          <UserFromA />
        </tenantA.Provider>
        <tenantB.Provider config={makeStoreConfig()}>
          <SeedB />
          <UserFromB />
        </tenantB.Provider>
      </>,
    );

    // Each tenant sees its own seeded data. If they shared storage, both
    // would show the same name (whichever Provider mounted last).
    expect(screen.getByTestId("tenant-a").textContent).toBe("AliceA");
    expect(screen.getByTestId("tenant-b").textContent).toBe("BobB");
  });
});

// =============================================================================
// Provider `initial` prop — seeds documents and queries before first render
// =============================================================================

describe("Provider initial data seeding", () => {
  it("seeds model documents into the store before the first render", () => {
    const user1 = makeUser("seed1");
    const user2 = makeUser("seed2");

    const UserDisplay = tracked(function UserDisplay() {
      const h1 = useDocument("user", "seed1");
      const h2 = useDocument("user", "seed2");
      return (
        <div>
          <span data-testid="u1">
            {h1.value !== undefined ? h1.value.attributes.firstName : "—"}
          </span>
          <span data-testid="u2">
            {h2.value !== undefined ? h2.value.attributes.firstName : "—"}
          </span>
        </div>
      );
    });

    render(
      <Provider
        config={makeStoreConfig()}
        initial={{ model: { user: { seed1: user1, seed2: user2 } } }}
      >
        <UserDisplay />
      </Provider>,
    );

    expect(screen.getByTestId("u1").textContent).toBe(`User${user1.id}`);
    expect(screen.getByTestId("u2").textContent).toBe(`User${user2.id}`);
  });

  it("seeds query results into the store before the first render", () => {
    const params: DashboardParams = { workspaceId: 99, filters: { active: true } };
    const result = makeDashboard(99);

    const QueryDisplay = tracked(function QueryDisplay() {
      const handle = useQuery("dashboard", params);
      return (
        <span data-testid="q">
          {handle.value !== undefined ? handle.value.totalActiveUsers : "—"}
        </span>
      );
    });

    render(
      <Provider config={makeStoreConfig()} initial={{ query: { dashboard: [{ params, result }] } }}>
        <QueryDisplay />
      </Provider>,
    );

    expect(screen.getByTestId("q").textContent).toBe(String(result.totalActiveUsers));
  });
});

// =============================================================================
// Provider `store` prop — adopt a store built outside React instead of
// constructing one from `config`. Useful for SSR setup, an imperative handle
// held before React mounts, or one store shared across trees.
// =============================================================================

describe("Provider store prop", () => {
  it("adopts a pre-built store — hooks read from the provided instance", () => {
    const store = createDocumentStore<TypeToModel, TypeToQuery>(makeStoreConfig());
    store.insertDocument("user", makeUser("1", { firstName: "Prebuilt" }));

    render(
      <Provider store={store}>
        <UserBadge userId="1" />
      </Provider>,
    );

    // No `config` was constructed — the badge reads the doc that was inserted
    // into the externally-built store before render.
    expect(screen.getByText("Prebuilt")).toBeDefined();
  });

  it("shares one adopted store across two Providers", () => {
    const store = createDocumentStore<TypeToModel, TypeToQuery>(makeStoreConfig());

    // Write-only seed — plain component, not `tracked` (see SeedUser note).
    function Seed() {
      const s = useDocumentStore();
      s.insertDocument("user", makeUser("1", { firstName: "Shared" }));
      return null;
    }

    render(
      <>
        <Provider store={store}>
          <Seed />
        </Provider>
        <Provider store={store}>
          <UserBadge userId="1" />
        </Provider>
      </>,
    );

    // Both Providers adopt the same instance, so a doc the first tree seeded is
    // visible in the second. A `config`-constructed Provider would isolate them.
    expect(screen.getByText("Shared")).toBeDefined();
  });

  it("applies `initial` seeding and `onMount` against an adopted store", () => {
    const store = createDocumentStore<TypeToModel, TypeToQuery>(makeStoreConfig());
    let mountedWith: DocumentStore<TypeToModel, TypeToQuery> | null = null;

    render(
      <Provider
        store={store}
        initial={{ model: { user: { "1": makeUser("1", { firstName: "Seeded" }) } } }}
        onMount={(s) => {
          mountedWith = s;
        }}
      >
        <UserBadge userId="1" />
      </Provider>,
    );

    expect(screen.getByText("Seeded")).toBeDefined();
    // onMount received the very store we passed in, not a fresh construction.
    expect(mountedWith).toBe(store);
  });

  it("throws when neither config nor store is provided", () => {
    expect(() =>
      render(
        <Provider>
          <span>child</span>
        </Provider>,
      ),
    ).toThrow(/requires either a .config.*or a .store./);
  });

  it("throws when both config and store are provided", () => {
    // `config` and `store` are the two ends of one pipeline; an adopted store
    // already has its config baked in, so supplying both is a contradiction.
    // Both props are optional, so this is type-legal — the guard is runtime.
    const store = createDocumentStore<TypeToModel, TypeToQuery>(makeStoreConfig());

    expect(() =>
      render(
        <Provider config={makeStoreConfig()} store={store}>
          <span>child</span>
        </Provider>,
      ),
    ).toThrow(/exactly one of .config.*or .store.*not both/);
  });
});

// =============================================================================
// Component unmount during in-flight fetch — no leaks, no errors after the
// fetch eventually resolves. UI code routinely mounts a component, kicks
// off a fetch, and unmounts it before the response lands (e.g. user
// navigates away). The contract is: the late resolution must not crash,
// must not throw, and must not log a React state-update warning.
// =============================================================================

describe("unmount during in-flight fetch", () => {
  it("does not throw or warn when a fetch resolves after the component unmounts", async () => {
    const errors: Array<unknown> = [];
    const originalError = console.error;
    console.error = (...args: Array<unknown>) => {
      errors.push(args);
    };

    try {
      const { unmount } = render(
        <Wrap>
          <UserBadge userId="1" />
        </Wrap>,
      );

      // The fetch is in flight. Unmount before MSW responds.
      expect(screen.getByText("loading")).toBeDefined();
      unmount();

      // Let the in-flight fetch resolve into the (now-unmounted) tree.
      await tick();

      // No console.error from React (or anywhere) for this scenario.
      expect(errors).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });
});

describe("Provider initial data — null/undefined guards", () => {
  // Force-types `undefined` as `T` for negative-path tests that intentionally
  // drive out-of-contract values into the Provider to verify it survives.
  function asInvalid<T>(): T {
    return undefined as T;
  }

  it("skips an undefined model bucket", () => {
    const nullBucketInitial = {
      model: {
        user: asInvalid<Record<string, User>>(),
      },
    };

    expect(() =>
      render(
        <Provider config={makeStoreConfig()} initial={nullBucketInitial}>
          <span data-testid="ok">ok</span>
        </Provider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("ok").textContent).toBe("ok");
  });

  it("skips undefined model entries", () => {
    const sparseInitial = {
      model: {
        user: {
          ghost: asInvalid<User>(),
        },
      },
    };

    expect(() =>
      render(
        <Provider config={makeStoreConfig()} initial={sparseInitial}>
          <span data-testid="ok">ok</span>
        </Provider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("ok").textContent).toBe("ok");
  });

  it("skips an undefined query result list", () => {
    const nullListInitial = {
      query: {
        dashboard: asInvalid<Array<{ params: DashboardParams; result: Dashboard }>>(),
      },
    };

    expect(() =>
      render(
        <Provider config={makeStoreConfig()} initial={nullListInitial}>
          <span data-testid="ok">rendered</span>
        </Provider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("ok").textContent).toBe("rendered");
  });

  it("ignores undefined model entries in an initial bucket", () => {
    const user = makeUser("seeded");

    const UserDisplay = tracked(function UserDisplay() {
      const handle = useDocument("user", "seeded");
      return (
        <span data-testid="seeded">
          {handle.value !== undefined ? handle.value.attributes.firstName : "-"}
        </span>
      );
    });

    render(
      <Provider
        config={makeStoreConfig()}
        initial={{
          model: { user: { seeded: user, missing: asInvalid<User>() } },
        }}
      >
        <UserDisplay />
      </Provider>,
    );

    expect(screen.getByTestId("seeded").textContent).toBe(`User${user.id}`);
  });
});
