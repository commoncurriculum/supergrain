import { render, screen, cleanup } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, it, expect } from "vitest";

import { DocumentStore, Finder, type DocumentAdapter } from "../../src";
import { createDocumentStoreContext } from "../../src/react";

// =============================================================================
// Test models
// =============================================================================

interface User {
  id: string;
  type: "user";
  attributes: { firstName: string; lastName: string; email: string };
}

interface Post {
  id: string;
  type: "post";
  attributes: { title: string; body: string; authorId: string };
}

type TypeToModel = {
  user: User;
  post: Post;
};

// =============================================================================
// Helpers — each test file uses its own isolated context via the factory,
// which gives typed hooks without polluting the global TypeRegistry.
// =============================================================================

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function makeUserAdapter(): DocumentAdapter {
  return {
    find: (ids) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          type: "user" as const,
          attributes: {
            firstName: `User${id}`,
            lastName: "Test",
            email: `user${id}@example.com`,
          },
        })),
      ),
  };
}

function makePostAdapter(): DocumentAdapter {
  return {
    find: (ids) =>
      Promise.resolve(
        ids.map((id) => ({
          id,
          type: "post" as const,
          attributes: { title: `Post${id}`, body: "b", authorId: "1" },
        })),
      ),
  };
}

function initStore(): DocumentStore<TypeToModel> {
  const finder = new Finder<TypeToModel>({
    models: {
      user: { adapter: makeUserAdapter() },
      post: { adapter: makePostAdapter() },
    },
    batchWindowMs: 15,
  });
  return new DocumentStore<TypeToModel>({ finder });
}

// One isolated context for this whole test file — typed for TypeToModel.
const { Provider, useDocument, useDocumentStore } = createDocumentStoreContext<TypeToModel>();

function wrapper(opts: { strict?: boolean } = {}) {
  const strict = opts.strict ?? true;
  return function Wrap({ children }: { children: ReactNode }) {
    const content = <Provider init={initStore}>{children}</Provider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
}

// =============================================================================
// Provider + useDocumentStore
// =============================================================================

describe("createDocumentStoreContext — Provider", () => {
  it("provides the store to descendants", () => {
    const Wrap = wrapper();

    let captured: unknown;
    const Probe = () => {
      captured = useDocumentStore();
      return null;
    };

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    expect(captured).toBeInstanceOf(DocumentStore);
    cleanup();
  });
});

describe("createDocumentStoreContext — useDocumentStore", () => {
  it("throws outside the Provider", () => {
    const Probe = () => {
      useDocumentStore();
      return null;
    };

    expect(() => render(<Probe />)).toThrow(/must be used within/i);
    cleanup();
  });
});

// =============================================================================
// useDocument
// =============================================================================

describe("createDocumentStoreContext — useDocument", () => {
  it("renders loading state and then data for a single id", async () => {
    const Wrap = wrapper();

    const UserBadge = ({ userId }: { userId: string }) => {
      const handle = useDocument("user", userId);
      if (handle.isPending) return <span>loading</span>;
      if (handle.error) return <span>error: {handle.error.message}</span>;
      return <span>{handle.data?.attributes.firstName}</span>;
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

  it("returns an idle handle when id is null", () => {
    const Wrap = wrapper();

    const MaybeBadge = ({ userId }: { userId: string | null }) => {
      const handle = useDocument("user", userId);
      if (handle.status === "IDLE") return <span>none</span>;
      return <span>{handle.data?.attributes.firstName ?? "…"}</span>;
    };

    render(
      <Wrap>
        <MaybeBadge userId={null} />
      </Wrap>,
    );

    expect(screen.getByText("none")).toBeDefined();
    cleanup();
  });
});

// =============================================================================
// Isolation — two factory instances don't collide
// =============================================================================

describe("createDocumentStoreContext — isolation", () => {
  it("two factory instances don't see each other's stores", () => {
    const ctxA = createDocumentStoreContext<TypeToModel>();
    const ctxB = createDocumentStoreContext<TypeToModel>();

    let storeA: unknown = null;
    let storeB: unknown = null;

    const ProbeA = () => {
      storeA = ctxA.useDocumentStore();
      return null;
    };

    const ProbeB = () => {
      storeB = ctxB.useDocumentStore();
      return null;
    };

    render(
      <ctxA.Provider init={initStore}>
        <ctxB.Provider init={initStore}>
          <ProbeA />
          <ProbeB />
        </ctxB.Provider>
      </ctxA.Provider>,
    );

    expect(storeA).toBeInstanceOf(DocumentStore);
    expect(storeB).toBeInstanceOf(DocumentStore);
    expect(storeA).not.toBe(storeB);
    cleanup();
  });
});
