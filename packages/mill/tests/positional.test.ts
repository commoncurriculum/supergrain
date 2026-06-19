import { createReactive } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { update } from "../src";

// =============================================================================
// Positional updates
//
// The second argument to `update` is a MongoDB query, used to resolve the
// positional operators in update paths:
//
//   $    — the first array element the query matches.
//   $[]  — every array element.
//
// The query does not need to identify the document (it's already selected); it
// only pins down which array element `$` refers to.
// =============================================================================

interface Board {
  cards: Array<{ id: string; title: string; done: boolean; votes: number }>;
}

function board(): Board {
  return {
    cards: [
      { id: "card-1", title: "One", done: false, votes: 0 },
      { id: "card-2", title: "Two", done: false, votes: 3 },
      { id: "card-3", title: "Three", done: false, votes: 7 },
    ],
  };
}

describe("positional $ — $elemMatch query", () => {
  it("resolves $ to the matched element and updates it", () => {
    const store = createReactive(board());

    update(
      store,
      { cards: { $elemMatch: { id: "card-2" } } },
      { $set: { "cards.$.title": "Two!" } },
    );

    expect(store.cards[1]!.title).toBe("Two!");
    expect(store.cards[0]!.title).toBe("One");
  });

  it("works with $inc and produces an undo that reverses it", () => {
    const store = createReactive(board());

    const { undo } = update(
      store,
      { cards: { $elemMatch: { id: "card-3" } } },
      { $inc: { "cards.$.votes": 5 } },
    );
    expect(store.cards[2]!.votes).toBe(12);

    update(store, {}, undo);
    expect(store.cards[2]!.votes).toBe(7);
  });

  it("matches by an operator condition inside $elemMatch", () => {
    const store = createReactive(board());

    update(
      store,
      { cards: { $elemMatch: { votes: { $gte: 5 } } } },
      { $set: { "cards.$.done": true } },
    );

    // card-3 is the first with votes >= 5.
    expect(store.cards.map((c) => c.done)).toEqual([false, false, true]);
  });
});

describe("positional $ — dotted-field query", () => {
  it("resolves $ from a dotted equality condition", () => {
    const store = createReactive(board());

    update(store, { "cards.id": "card-2" }, { $set: { "cards.$.done": true } });

    expect(store.cards.map((c) => c.done)).toEqual([false, true, false]);
  });
});

describe("positional $ — array of primitives", () => {
  it("resolves $ from a whole-element equality condition", () => {
    const store = createReactive({ nums: [1, 2, 3] });

    update(store, { nums: 2 }, { $set: { "nums.$": 20 } });

    expect(store.nums).toEqual([1, 20, 3]);
  });

  it("falls back to the first element when the query says nothing about the array", () => {
    const store = createReactive({ nums: [1, 2, 3] });

    update(store, {}, { $inc: { "nums.$": 100 } });

    expect(store.nums).toEqual([101, 2, 3]);
  });

  it("throws when $ targets an empty array with no matching element", () => {
    const store = createReactive({ nums: [] as Array<number> });
    expect(() => update(store, {}, { $set: { "nums.$": 1 } })).toThrow(/positional operator/i);
  });
});

describe("positional $[] — all elements", () => {
  it("updates a field on every element", () => {
    const store = createReactive(board());

    update(store, {}, { $set: { "cards.$[].done": true } });

    expect(store.cards.every((c) => c.done)).toBe(true);
  });

  it("produces an undo that restores every element", () => {
    const store = createReactive(board());

    const { undo } = update(store, {}, { $inc: { "cards.$[].votes": 10 } });
    expect(store.cards.map((c) => c.votes)).toEqual([10, 13, 17]);

    update(store, {}, undo);
    expect(store.cards.map((c) => c.votes)).toEqual([0, 3, 7]);
  });
});

describe("positional resolution errors", () => {
  it("throws when no element matches the query", () => {
    const store = createReactive(board());
    expect(() =>
      update(
        store,
        { cards: { $elemMatch: { id: "missing" } } },
        { $set: { "cards.$.title": "x" } },
      ),
    ).toThrow(/positional operator/i);
  });

  it("throws when the positional prefix is not an array", () => {
    const store = createReactive<any>({ cards: { id: "card-1" } });
    expect(() => update(store, {}, { $set: { "cards.$.title": "x" } })).toThrow(
      /requires an array/i,
    );
  });
});

// =============================================================================
// Query matcher — the standard Mongo query operators used during resolution.
// Exercised black-box through `$` resolution.
// =============================================================================

interface Items {
  items: Array<{ name: string; qty: number; tags: Array<string> }>;
}

function items(): Items {
  return {
    items: [
      { name: "a", qty: 1, tags: ["x"] },
      { name: "b", qty: 5, tags: ["y", "z"] },
      { name: "c", qty: 9, tags: ["z"] },
    ],
  };
}

// Marks the element that `$` resolved to and returns its index as a string, so
// each query operator can be pinned to the element it selects.
function firstMatchedName(query: any): string {
  const store = createReactive(items());
  update(store, query, { $set: { "items.$.name": "MATCHED" } });
  return String(store.items.findIndex((i) => i.name === "MATCHED"));
}

describe("query operators", () => {
  it("$eq / implicit equality", () => {
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $eq: 5 } } } })).toBe("1");
    expect(firstMatchedName({ items: { $elemMatch: { qty: 9 } } })).toBe("2");
  });

  it("$ne", () => {
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $ne: 1 } } } })).toBe("1");
  });

  it("$gt / $gte / $lt / $lte", () => {
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $gt: 1 } } } })).toBe("1");
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $gte: 5 } } } })).toBe("1");
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $lt: 5 } } } })).toBe("0");
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $lte: 1 } } } })).toBe("0");
  });

  it("$in / $nin", () => {
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $in: [5, 9] } } } })).toBe("1");
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $nin: [1, 5] } } } })).toBe("2");
  });

  it("$exists", () => {
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $exists: true } } } })).toBe("0");
  });

  it("$not", () => {
    expect(firstMatchedName({ items: { $elemMatch: { qty: { $not: { $lt: 5 } } } } })).toBe("1");
  });

  it("$elemMatch against a nested array field", () => {
    expect(
      firstMatchedName({ items: { $elemMatch: { tags: { $elemMatch: { $eq: "z" } } } } }),
    ).toBe("1");
  });

  it("$and / $or / $nor", () => {
    expect(
      firstMatchedName({ items: { $elemMatch: { $and: [{ qty: { $gte: 5 } }, { name: "c" }] } } }),
    ).toBe("2");
    // Single-clause $or so the earlier elements fail the combinator first.
    expect(firstMatchedName({ items: { $elemMatch: { $or: [{ qty: 9 }] } } })).toBe("2");
    expect(firstMatchedName({ items: { $elemMatch: { $nor: [{ qty: 1 }, { qty: 5 }] } } })).toBe(
      "2",
    );
  });

  it("matches a field by deep object equality", () => {
    const store = createReactive({
      items: [{ meta: { k: 1 } }, { meta: { k: 2 } }],
    });
    update(
      store,
      { items: { $elemMatch: { meta: { k: 2 } } } },
      { $set: { "items.$.meta.k": 99 } },
    );
    expect(store.items.map((i) => i.meta.k)).toEqual([1, 99]);
  });

  it("resolves $ from a deeply dotted field query", () => {
    const store = createReactive({
      items: [{ meta: { k: 1 } }, { meta: { k: 2 } }],
    });
    update(store, { "items.meta.k": 2 }, { $set: { "items.$.meta.k": 99 } });
    expect(store.items.map((i) => i.meta.k)).toEqual([1, 99]);
  });
});

describe("positional $ at the document root (array document)", () => {
  it("resolves $ against the document itself when it is an array", () => {
    const doc: Array<number> = [1, 2, 3];
    update(doc, {}, { $set: { $: 9 } });
    expect(doc).toEqual([9, 2, 3]);
  });

  it("throws on an unsupported operator", () => {
    const store = createReactive(items());
    expect(() =>
      update(
        store,
        { items: { $elemMatch: { qty: { $mod: [2, 0] } } } },
        {
          $set: { "items.$.name": "x" },
        },
      ),
    ).toThrow(/unsupported query operator/i);
  });
});
