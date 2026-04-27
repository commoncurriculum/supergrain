import { tracked } from "@supergrain/kernel/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
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

const { Provider, useDocument, useDocumentStore, useQuery } =
  createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();

const userAdapter: DocumentAdapter = {
  async find(ids) {
    if (usersShouldFail) {
      throw new Error("/users responded 500");
    }
    return ids.map((id) => makeUser(id));
  },
};

const dashboardAdapter: QueryAdapter<DashboardParams> = {
  async find(paramsList) {
    if (dashboardsShouldFail) {
      throw new Error("/dashboards responded 500");
    }
    return paramsList.map((params) => makeDashboard(params.workspaceId));
  },
};

function makeStoreConfig(): DocumentStoreConfig<TypeToModel, TypeToQuery> {
  return {
    models: {
      user: { adapter: userAdapter },
    },
    queries: {
      dashboard: { adapter: dashboardAdapter },
    },
  };
}

function Wrap({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <Provider config={makeStoreConfig()}>{children}</Provider>
    </StrictMode>
  );
}

const SeedUser = tracked(function SeedUser({ user }: { user: User }) {
  const store = useDocumentStore();
  store.insertDocument("user", user);
  return null;
});

// =============================================================================
// Realistic components the tests render — same shape a consumer would write.
// =============================================================================

const UserBadge = tracked(function UserBadge({ userId }: { userId: string | null | undefined }) {
  const handle = useDocument("user", userId);
  if (handle.status === "IDLE") return <span>no user</span>;
  if (handle.isPending) return <span>loading</span>;
  if (handle.error) return <span>error: {handle.error.message}</span>;
  return <span>{handle.data?.attributes.firstName}</span>;
});

const UserList = tracked(function UserList({ ids }: { ids: ReadonlyArray<string> }) {
  const store = useDocumentStore();
  const handles = ids.map((id) => store.find("user", id));

  if (handles.length === 0) return <span>no users</span>;
  if (handles.some((handle) => handle.error)) return <span>error</span>;
  if (handles.some((handle) => handle.isPending)) return <span>loading</span>;

  return (
    <ul>
      {handles.map((handle) =>
        handle.data ? <li key={handle.data.id}>{handle.data.attributes.firstName}</li> : null,
      )}
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
  if (handle.status === "IDLE") return <span>no dashboard</span>;
  if (handle.isPending) return <span>loading dashboard</span>;
  if (handle.error) return <span>error: {handle.error.message}</span>;
  return <span>users: {handle.data?.totalActiveUsers}</span>;
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

    await tick();

    expect(screen.getByText("User1")).toBeDefined();
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

    await tick();

    expect(screen.getByText("User1")).toBeDefined();
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

    await tick();

    expect(screen.getByText("error")).toBeDefined();
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

    await tick();

    // dashboard MSW handler encodes workspaceId * 10 into totalActiveUsers.
    expect(screen.getByText("users: 70")).toBeDefined();
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

    await tick();

    expect(screen.getByText(/error:/)).toBeDefined();
  });
});

// =============================================================================
// Factory isolation — two factory instances keep their stores separate.
// =============================================================================

describe("createDocumentStoreContext isolation", () => {
  it("two independent stores render their own data side-by-side", () => {
    const tenantA = createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();
    const tenantB = createDocumentStoreContext<DocumentStore<TypeToModel, TypeToQuery>>();

    const SeedA = tracked(function SeedA() {
      const store = tenantA.useDocumentStore();
      store.insertDocument("user", makeUser("1", { firstName: "AliceA" }));
      return null;
    });

    const SeedB = tracked(function SeedB() {
      const store = tenantB.useDocumentStore();
      store.insertDocument("user", makeUser("1", { firstName: "BobB" }));
      return null;
    });

    const UserFromA = tracked(function UserFromA() {
      const handle = tenantA.useDocument("user", "1");
      return <span data-testid="tenant-a">{handle.data?.attributes.firstName ?? "—"}</span>;
    });
    const UserFromB = tracked(function UserFromB() {
      const handle = tenantB.useDocument("user", "1");
      return <span data-testid="tenant-b">{handle.data?.attributes.firstName ?? "—"}</span>;
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
          <span data-testid="u1">{h1.data?.attributes.firstName ?? "—"}</span>
          <span data-testid="u2">{h2.data?.attributes.firstName ?? "—"}</span>
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

    // No network request — data was seeded directly into the store
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
          {handle.data?.totalActiveUsers ?? "—"}
        </span>
      );
    });

    render(
      <Provider
        config={makeStoreConfig()}
        initial={{ query: { dashboard: [{ params, result }] } }}
      >
        <QueryDisplay />
      </Provider>,
    );

    expect(screen.getByTestId("q").textContent).toBe(String(result.totalActiveUsers));
  });
});
