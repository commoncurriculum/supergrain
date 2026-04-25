import { tracked } from "@supergrain/kernel/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type ReactNode, StrictMode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { type DocumentStore } from "../../src";
import { createSiloContext } from "../../src/react";
import {
  API_BASE,
  clearRequests,
  makeStoreConfig,
  makeUser,
  server,
  type TypeToModel,
  type TypeToQuery,
  type User,
} from "../example-app";

// =============================================================================
// MSW lifecycle — the shared example-app MSW server handles /users and /posts.
// Each test builds a fresh DocumentStore via initStore() so in-memory state is
// isolated across tests.
// =============================================================================

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  clearRequests();
  cleanup();
});

// =============================================================================
// Per-file isolated context via the factory, typed for TypeToModel (so the
// hooks don't rely on global TypeRegistry augmentation).
// =============================================================================

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

const { Provider, useDocument, useSilo, useQuery } =
  createSiloContext<DocumentStore<TypeToModel, TypeToQuery>>();

function Wrap({ children }: { children: ReactNode }) {
  return (
    <StrictMode>
      <Provider config={makeStoreConfig()}>{children}</Provider>
    </StrictMode>
  );
}

const SeedUser = tracked(function SeedUser({ user }: { user: User }) {
  const store = useSilo();
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
  const store = useSilo();
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

describe("createSiloContext Provider", () => {
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
// useSilo composition over many documents
// =============================================================================

describe("useSilo + find composition", () => {
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
    server.use(
      http.get(`${API_BASE}/users`, () => HttpResponse.json({ message: "boom" }, { status: 500 })),
    );

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
// useSilo — the imperative escape hatch (e.g. for socket pushes,
// "save" buttons, clearMemory on logout).
// =============================================================================

describe("useSilo", () => {
  it("exposes the store for imperative writes (e.g. socket push → insertDocument)", () => {
    const PushSimulator = tracked(function PushSimulator({ user }: { user: User }) {
      // A component that simulates an external source (websocket, admin tool,
      // etc.) writing directly to the store. Real apps do this inside effects
      // that subscribe to transport events.
      const store = useSilo();
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
    server.use(
      http.get(`${API_BASE}/dashboards`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );

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

describe("createSiloContext isolation", () => {
  it("two independent stores render their own data side-by-side", () => {
    const tenantA = createSiloContext<DocumentStore<TypeToModel, TypeToQuery>>();
    const tenantB = createSiloContext<DocumentStore<TypeToModel, TypeToQuery>>();

    const SeedA = tracked(function SeedA() {
      const store = tenantA.useSilo();
      store.insertDocument("user", makeUser("1", { firstName: "AliceA" }));
      return null;
    });

    const SeedB = tracked(function SeedB() {
      const store = tenantB.useSilo();
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
