import type { DocumentAdapter } from "@supergrain/store";

import { Finder, Store } from "@supergrain/store";
import { render, screen, cleanup } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, it, expect } from "vitest";

import { StoreContext } from "../src";

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

function makeContext(opts: { strict?: boolean } = {}) {
  const finder = new Finder<TypeToModel>({
    models: {
      user: { adapter: makeUserAdapter() },
      post: { adapter: makePostAdapter() },
    },
    batchWindowMs: 15,
  });

  const store = new Store<TypeToModel>({ finder });
  const ctx = new StoreContext<TypeToModel>(store);

  const strict = opts.strict ?? true;
  const Wrap = ({ children }: { children: ReactNode }) =>
    strict ? (
      <StrictMode>
        <ctx.Provider>{children}</ctx.Provider>
      </StrictMode>
    ) : (
      <ctx.Provider>{children}</ctx.Provider>
    );

  return { ctx, store, Wrap };
}

// =============================================================================
// new StoreContext
// =============================================================================

describe("new StoreContext", () => {
  it("exposes Provider + hooks", () => {
    const { ctx } = makeContext();

    expect(ctx.Provider).toBeDefined();
    expect(typeof ctx.useStore).toBe("function");
    expect(typeof ctx.useDocument).toBe("function");
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
      const handle = ctx.useDocument("user", userId);
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
    const { ctx, Wrap } = makeContext();

    const MaybeBadge = ({ userId }: { userId: string | null }) => {
      const handle = ctx.useDocument("user", userId);
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
