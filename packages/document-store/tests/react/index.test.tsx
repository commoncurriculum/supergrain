import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type ReactNode, StrictMode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { type DocumentStore } from "../../src";
import { createDocumentStoreContext } from "../../src/react";
import {
  API_BASE,
  clearRequests,
  initStore,
  makeUser,
  server,
  type TypeToModel,
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

const { Provider, useDocument, useDocuments, useDocumentStore } =
  createDocumentStoreContext<TypeToModel>();

function Wrap({
  init = initStore,
  children,
}: {
  init?: () => DocumentStore<TypeToModel>;
  children: ReactNode;
}) {
  return (
    <StrictMode>
      <Provider init={init}>{children}</Provider>
    </StrictMode>
  );
}

// =============================================================================
// Realistic components the tests render — same shape a consumer would write.
// =============================================================================

function UserBadge({ userId }: { userId: string | null | undefined }) {
  const handle = useDocument("user", userId);
  if (handle.status === "IDLE") return <span>no user</span>;
  if (handle.isPending) return <span>loading</span>;
  if (handle.error) return <span>error: {handle.error.message}</span>;
  return <span>{handle.data?.attributes.firstName}</span>;
}

function UserList({ ids }: { ids: ReadonlyArray<string> }) {
  const handle = useDocuments("user", ids);
  if (handle.status === "IDLE") return <span>no users</span>;
  if (handle.isPending) return <span>loading</span>;
  if (handle.error) return <span>error</span>;
  return (
    <ul>
      {handle.data?.map((u) => (
        <li key={u.id}>{u.attributes.firstName}</li>
      ))}
    </ul>
  );
}

// =============================================================================
// Provider — hooks work inside it, throw outside it.
// =============================================================================

describe("DocumentStoreProvider", () => {
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
    // Pre-seed user 1. The badge should render "Alice" synchronously without
    // ever passing through a loading state — proves find() hits memory before
    // delegating to the finder.
    function init() {
      const store = initStore();
      store.insertDocument("user", makeUser("1", { firstName: "Alice" }));
      return store;
    }

    render(
      <Wrap init={init}>
        <UserBadge userId="1" />
      </Wrap>,
    );

    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.queryByText("loading")).toBeNull();
  });
});

// =============================================================================
// useDocuments
// =============================================================================

describe("useDocuments", () => {
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
// useDocumentStore — the imperative escape hatch (e.g. for socket pushes,
// "save" buttons, clearMemory on logout).
// =============================================================================

describe("useDocumentStore", () => {
  it("exposes the store for imperative writes (e.g. socket push → insertDocument)", () => {
    function PushSimulator({ user }: { user: User }) {
      // A component that simulates an external source (websocket, admin tool,
      // etc.) writing directly to the store. Real apps do this inside effects
      // that subscribe to transport events.
      const store = useDocumentStore();
      return (
        <button type="button" onClick={() => store.insertDocument("user", user)}>
          simulate push
        </button>
      );
    }

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
// Factory isolation — two factory instances keep their stores separate.
// =============================================================================

describe("createDocumentStoreContext isolation", () => {
  it("two independent stores render their own data side-by-side", () => {
    const tenantA = createDocumentStoreContext<TypeToModel>();
    const tenantB = createDocumentStoreContext<TypeToModel>();

    function initA() {
      const store = initStore();
      store.insertDocument("user", makeUser("1", { firstName: "AliceA" }));
      return store;
    }

    function initB() {
      const store = initStore();
      store.insertDocument("user", makeUser("1", { firstName: "BobB" }));
      return store;
    }

    function UserFromA() {
      const handle = tenantA.useDocument("user", "1");
      return <span data-testid="tenant-a">{handle.data?.attributes.firstName ?? "—"}</span>;
    }
    function UserFromB() {
      const handle = tenantB.useDocument("user", "1");
      return <span data-testid="tenant-b">{handle.data?.attributes.firstName ?? "—"}</span>;
    }

    render(
      <>
        <tenantA.Provider init={initA}>
          <UserFromA />
        </tenantA.Provider>
        <tenantB.Provider init={initB}>
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
