import { render, screen, cleanup } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, it, expect } from "vitest";

import { DocumentStore, Finder, type DocumentAdapter } from "../../src";
import { DocumentStoreProvider, useDocument, useDocumentStore } from "../../src/react";

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
// Helpers
// =============================================================================

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// Adapters return a bare array of documents — matches the library's
// defaultProcessor. For the envelope path, tests can provide their own
// adapter + jsonApiProcessor the same way a consumer would.
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

function wrapper(opts: { strict?: boolean } = {}) {
  const strict = opts.strict ?? true;
  return function Wrap({ children }: { children: ReactNode }) {
    const content = (
      <DocumentStoreProvider<TypeToModel> init={initStore}>{children}</DocumentStoreProvider>
    );
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
}

// =============================================================================
// DocumentStoreProvider + useDocumentStore
// =============================================================================

describe("DocumentStoreProvider", () => {
  it("provides the store to descendants", () => {
    const Wrap = wrapper();

    let captured: unknown;
    const Probe = () => {
      captured = useDocumentStore<TypeToModel>();
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

describe("useDocumentStore", () => {
  it("throws outside the Provider", () => {
    const Probe = () => {
      useDocumentStore<TypeToModel>();
      return null;
    };

    expect(() => render(<Probe />)).toThrow(/must be used within/i);
    cleanup();
  });
});

// =============================================================================
// useDocument
// =============================================================================

describe("useDocument", () => {
  it("renders loading state and then data for a single id", async () => {
    const Wrap = wrapper();

    const UserBadge = ({ userId }: { userId: string }) => {
      const handle = useDocument<TypeToModel, "user">("user", userId);
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
      const handle = useDocument<TypeToModel, "user">("user", userId);
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
