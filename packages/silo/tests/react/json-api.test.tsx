import type { Relationship, RelationshipArray } from "../../src/processors/json-api";

import { tracked } from "@supergrain/kernel/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { type DocumentAdapter, type DocumentStore } from "../../src";
import { createDocumentStoreContext } from "../../src/react";
import { useBelongsTo, useHasMany, useHasManyIndividually } from "../../src/react/json-api";

// =============================================================================
// Test models (JSON-API shape).
// The CardStack type threads Relationship<Planbook> and RelationshipArray<Card>
// so useBelongsTo/useHasMany can infer their return types without a cast.
// =============================================================================

interface Planbook {
  id: string;
  type: "planbook";
  attributes: { title: string };
}

interface Card {
  id: string;
  type: "card";
  attributes: { title: string };
}

interface CardStack {
  id: string;
  type: "card-stack";
  attributes: { title: string };
  relationships: {
    planbook: Relationship<Planbook>;
    cards: RelationshipArray<Card>;
  };
}

type TypeToModel = {
  planbook: Planbook;
  card: Card;
  "card-stack": CardStack;
};

// =============================================================================
// Inline async adapters — no network. Each returns canned docs for the ids
// it was given, matching the JSON-API shape (`type` + `id` + `attributes`).
// These prove the full load-then-render flow without MSW setup overhead.
// =============================================================================

const planbookAdapter: DocumentAdapter = {
  async find(ids) {
    return ids.map((id) => ({
      id,
      type: "planbook" as const,
      attributes: { title: `Planbook ${id}` },
    }));
  },
};

const cardAdapter: DocumentAdapter = {
  async find(ids) {
    return ids.map((id) => ({
      id,
      type: "card" as const,
      attributes: { title: `Card ${id}` },
    }));
  },
};

// card-stack is only fetched if the consumer directly asks for one; tests
// pre-seed stacks themselves so this adapter doesn't need real data.
const cardStackAdapter: DocumentAdapter = {
  find: () => new Promise(() => {}),
};

const { Provider, useDocument, useDocumentStore } =
  createDocumentStoreContext<DocumentStore<TypeToModel>>();

function Wrap({ children }: { children: ReactNode }) {
  return (
    <Provider
      config={{
        models: {
          planbook: { adapter: planbookAdapter },
          card: { adapter: cardAdapter },
          "card-stack": { adapter: cardStackAdapter },
        },
      }}
    >
      {children}
    </Provider>
  );
}

const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

afterEach(() => cleanup());

// =============================================================================
// Realistic components — shape a consumer would write. The CardStack gets
// pulled out of the store via useDocument, then passed into useBelongsTo /
// useHasMany to resolve the related docs.
// =============================================================================

const RelatedPlanbook = tracked(function RelatedPlanbook({ stackId }: { stackId: string }) {
  const stackHandle = useDocument("card-stack", stackId);
  const planbookHandle = useBelongsTo(stackHandle.data ?? null, "planbook");

  if (stackHandle.isPending) return <span data-testid="planbook">loading stack</span>;
  if (planbookHandle.status === "IDLE") return <span data-testid="planbook">no planbook</span>;
  if (planbookHandle.isPending) return <span data-testid="planbook">loading planbook</span>;
  if (planbookHandle.error) return <span data-testid="planbook">error</span>;
  return <span data-testid="planbook">{planbookHandle.data?.attributes.title}</span>;
});

const RelatedCards = tracked(function RelatedCards({ stackId }: { stackId: string }) {
  const stackHandle = useDocument("card-stack", stackId);
  const cardHandles = useHasMany(stackHandle.data ?? null, "cards");

  if (stackHandle.isPending) return <span data-testid="cards">loading stack</span>;
  if (cardHandles.length === 0) return <span data-testid="cards">no cards</span>;
  if (cardHandles.some((handle) => handle.error)) return <span data-testid="cards">error</span>;
  if (cardHandles.some((handle) => handle.isPending))
    return <span data-testid="cards">loading cards</span>;
  return (
    <ul data-testid="cards">
      {cardHandles.map((handle, i) => (
        <li key={handle.data?.id ?? i}>{handle.data?.attributes.title}</li>
      ))}
    </ul>
  );
});

const CardListIndividually = tracked(function CardListIndividually({
  stackId,
}: {
  stackId: string;
}) {
  const stackHandle = useDocument("card-stack", stackId);
  const cardHandles = useHasManyIndividually(stackHandle.data ?? null, "cards");

  if (stackHandle.isPending) return <span data-testid="cards">loading stack</span>;
  if (cardHandles.length === 0) return <span data-testid="cards">no cards</span>;
  return (
    <ul data-testid="cards">
      {cardHandles.map((c, i) => (
        <li key={i} data-testid={`card-${i}`}>
          {c.isPending ? "loading…" : c.error ? "error" : c.data?.attributes.title}
        </li>
      ))}
    </ul>
  );
});

// Imperative buttons — simulate socket pushes / admin edits. Models external
// code writing directly to the store.
const UpdatePlanbookButton = tracked(function UpdatePlanbookButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const store = useDocumentStore();
  return (
    <button
      type="button"
      onClick={() =>
        store.insertDocument("planbook", {
          id,
          type: "planbook",
          attributes: { title },
        })
      }
    >
      update planbook
    </button>
  );
});

const UpdateCardButton = tracked(function UpdateCardButton({
  id,
  title,
}: {
  id: string;
  title: string;
}) {
  const store = useDocumentStore();
  return (
    <button
      type="button"
      onClick={() =>
        store.insertDocument("card", {
          id,
          type: "card",
          attributes: { title },
        })
      }
    >
      update {id}
    </button>
  );
});

const SeedStack = tracked(function SeedStack({ stack }: { stack: CardStack }) {
  const store = useDocumentStore();
  store.insertDocument("card-stack", stack);
  return null;
});

const SeedPlanbook = tracked(function SeedPlanbook({ planbook }: { planbook: Planbook }) {
  const store = useDocumentStore();
  store.insertDocument("planbook", planbook);
  return null;
});

const SeedCard = tracked(function SeedCard({ card }: { card: Card }) {
  const store = useDocumentStore();
  store.insertDocument("card", card);
  return null;
});

// =============================================================================
// Helpers to build test stacks with controlled relationship shapes.
// =============================================================================

function makeStack(overrides: {
  id: string;
  planbookId?: string | null;
  cardIds?: Array<string>;
}): CardStack {
  return {
    id: overrides.id,
    type: "card-stack",
    attributes: { title: `Stack ${overrides.id}` },
    relationships: {
      planbook: {
        data: overrides.planbookId ? { type: "planbook", id: overrides.planbookId } : null,
      },
      cards: {
        data: (overrides.cardIds ?? []).map((id) => ({ type: "card", id })),
      },
    },
  };
}

// =============================================================================
// useBelongsTo
// =============================================================================

describe("useBelongsTo", () => {
  it("fetches the related doc and the UI transitions from loading to loaded", async () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", planbookId: "p42" })} />
        <RelatedPlanbook stackId="s1" />
      </Wrap>,
    );

    expect(screen.getByTestId("planbook").textContent).toBe("loading planbook");

    await tick();

    expect(screen.getByTestId("planbook").textContent).toBe("Planbook p42");
  });

  it("shows the related doc immediately when it's already in memory", async () => {
    render(
      <Wrap>
        <SeedPlanbook
          planbook={{ id: "p42", type: "planbook", attributes: { title: "Cached Planbook" } }}
        />
        <SeedStack stack={makeStack({ id: "s1", planbookId: "p42" })} />
        <RelatedPlanbook stackId="s1" />
      </Wrap>,
    );

    // No "loading planbook" state — it was already cached.
    expect(screen.getByTestId("planbook").textContent).toBe("Cached Planbook");

    await tick();

    // Still no network fetch; UI unchanged.
    expect(screen.getByTestId("planbook").textContent).toBe("Cached Planbook");
  });

  it("re-renders the UI when the related doc is updated externally", async () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", planbookId: "p42" })} />
        <RelatedPlanbook stackId="s1" />
        <UpdatePlanbookButton id="p42" title="Renamed" />
      </Wrap>,
    );

    await tick();
    expect(screen.getByTestId("planbook").textContent).toBe("Planbook p42");

    // Socket push / admin edit updates the related doc.
    fireEvent.click(screen.getByText("update planbook"));

    // UI reflects the change without a refetch.
    expect(screen.getByTestId("planbook").textContent).toBe("Renamed");
  });

  it("returns an idle handle when the relationship's data is null (no related doc)", () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", planbookId: null })} />
        <RelatedPlanbook stackId="s1" />
      </Wrap>,
    );

    expect(screen.getByTestId("planbook").textContent).toBe("no planbook");
  });
});

// =============================================================================
// useHasMany
// =============================================================================

describe("useHasMany", () => {
  it("fetches all related docs and the UI transitions from loading to a full list", async () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", cardIds: ["c1", "c2", "c3"] })} />
        <RelatedCards stackId="s1" />
      </Wrap>,
    );

    expect(screen.getByTestId("cards").textContent).toBe("loading cards");

    await tick();

    const list = screen.getByTestId("cards");
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list.textContent).toContain("Card c1");
    expect(list.textContent).toContain("Card c2");
    expect(list.textContent).toContain("Card c3");
  });

  it("shows the full list immediately when every related doc is already in memory", async () => {
    render(
      <Wrap>
        <SeedCard card={{ id: "c1", type: "card", attributes: { title: "Cached c1" } }} />
        <SeedCard card={{ id: "c2", type: "card", attributes: { title: "Cached c2" } }} />
        <SeedStack stack={makeStack({ id: "s1", cardIds: ["c1", "c2"] })} />
        <RelatedCards stackId="s1" />
      </Wrap>,
    );

    const list = screen.getByTestId("cards");
    expect(list.textContent).toContain("Cached c1");
    expect(list.textContent).toContain("Cached c2");

    await tick();
    // Still the same — no fetch.
    expect(list.textContent).toContain("Cached c1");
  });

  it("returns an idle handle when the relationship's data is empty", () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", cardIds: [] })} />
        <RelatedCards stackId="s1" />
      </Wrap>,
    );

    expect(screen.getByTestId("cards").textContent).toBe("no cards");
  });

  it("returns an empty array when the relationship is absent", () => {
    const MissingRelationship = tracked(function MissingRelationship() {
      const handles = useHasMany(
        {
          id: "s1",
          type: "card-stack",
          attributes: { title: "Stack" },
          relationships: {},
        } as any,
        "cards",
      );
      return <span data-testid="cards">{handles.length}</span>;
    });

    render(
      <Wrap>
        <MissingRelationship />
      </Wrap>,
    );

    expect(screen.getByTestId("cards").textContent).toBe("0");
  });
});

// =============================================================================
// useHasManyIndividually — per-item handles; each `<li>` has its own
// loading / data / error state.
// =============================================================================

describe("useHasManyIndividually", () => {
  it("renders each item's own loading state, then each item's own data", async () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", cardIds: ["c1", "c2", "c3"] })} />
        <CardListIndividually stackId="s1" />
      </Wrap>,
    );

    // Each <li> shows "loading…" while its own handle is pending.
    expect(screen.getByTestId("card-0").textContent).toBe("loading…");
    expect(screen.getByTestId("card-1").textContent).toBe("loading…");
    expect(screen.getByTestId("card-2").textContent).toBe("loading…");

    await tick();

    // Each <li> renders its own doc's title once loaded.
    expect(screen.getByTestId("card-0").textContent).toBe("Card c1");
    expect(screen.getByTestId("card-1").textContent).toBe("Card c2");
    expect(screen.getByTestId("card-2").textContent).toBe("Card c3");
  });

  it("shows cached items immediately and only unrelated items stay pending", async () => {
    // c1 is pre-seeded; c2 has to be fetched. The individual handles let
    // us render c1's title immediately while c2 still shows "loading…".
    render(
      <Wrap>
        <SeedCard card={{ id: "c1", type: "card", attributes: { title: "Cached c1" } }} />
        <SeedStack stack={makeStack({ id: "s1", cardIds: ["c1", "c2"] })} />
        <CardListIndividually stackId="s1" />
      </Wrap>,
    );

    // Per-item divergence: c1 is SUCCESS synchronously, c2 is PENDING.
    expect(screen.getByTestId("card-0").textContent).toBe("Cached c1");
    expect(screen.getByTestId("card-1").textContent).toBe("loading…");

    await tick();

    expect(screen.getByTestId("card-1").textContent).toBe("Card c2");
  });

  it("updates a single item reactively when only that doc is updated externally", async () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", cardIds: ["c1", "c2"] })} />
        <CardListIndividually stackId="s1" />
        <UpdateCardButton id="c1" title="Renamed c1" />
      </Wrap>,
    );

    await tick();
    expect(screen.getByTestId("card-0").textContent).toBe("Card c1");
    expect(screen.getByTestId("card-1").textContent).toBe("Card c2");

    // Socket push edits just c1. Only c1's <li> re-renders.
    fireEvent.click(screen.getByText("update c1"));

    expect(screen.getByTestId("card-0").textContent).toBe("Renamed c1");
    // c2 is unaffected by the c1 write.
    expect(screen.getByTestId("card-1").textContent).toBe("Card c2");
  });

  it("returns an empty array when the relationship's data is empty", () => {
    render(
      <Wrap>
        <SeedStack stack={makeStack({ id: "s1", cardIds: [] })} />
        <CardListIndividually stackId="s1" />
      </Wrap>,
    );

    expect(screen.getByTestId("cards").textContent).toBe("no cards");
  });
});

// =============================================================================
// Error: hooks used outside their Provider
// =============================================================================

describe("hooks used outside Provider", () => {
  it("useBelongsTo throws when used outside the Provider", () => {
    const Component = tracked(() => {
      useBelongsTo({} as any, "planbook" as any);
      return null;
    });

    expect(() => render(<Component />)).toThrow(/useBelongsTo must be used within the Provider/);
  });

  it("useHasMany throws when used outside the Provider", () => {
    const Component = tracked(() => {
      useHasMany({} as any, "cards" as any);
      return null;
    });

    expect(() => render(<Component />)).toThrow(/useHasMany must be used within the Provider/);
  });
});
