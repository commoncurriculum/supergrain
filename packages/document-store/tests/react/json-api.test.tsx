import type { Relationship, RelationshipArray } from "../../src/processors/json-api";

import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useBelongsTo, useHasMany } from "../../src/react/json-api";

// =============================================================================
// Test models (JSON-API shape)
// =============================================================================

interface Planbook {
  id: string;
  type: "planbook";
  attributes: { title: string };
}

interface CardStack {
  id: string;
  type: "card-stack";
  attributes: { title: string };
  relationships: {
    planbook: Relationship;
    cards: RelationshipArray;
  };
}

type TypeToModel = {
  planbook: Planbook;
  "card-stack": CardStack;
};

// =============================================================================
// API surface — once implementation exists, these tests will render a
// Provider + exercise the hooks. For now they exist to pin the call
// signatures at the module boundary.
// =============================================================================

describe("useBelongsTo", () => {
  it("is a callable function", () => {
    expect(typeof useBelongsTo).toBe("function");
  });

  it("throws (not yet implemented) when invoked inside a component", () => {
    const Probe = () => {
      useBelongsTo<TypeToModel, CardStack, "planbook">(null, "planbook");
      return null;
    };

    expect(() => render(<Probe />)).toThrow(/not yet implemented/i);
  });
});

describe("useHasMany", () => {
  it("is a callable function", () => {
    expect(typeof useHasMany).toBe("function");
  });

  it("throws (not yet implemented) when invoked inside a component", () => {
    const Probe = () => {
      useHasMany<TypeToModel, CardStack, "cards">(null, "cards");
      return null;
    };

    expect(() => render(<Probe />)).toThrow(/not yet implemented/i);
  });
});
