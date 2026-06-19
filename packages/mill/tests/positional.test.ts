import { createReactive, unwrap } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { update } from "../src";
import { applyWithUndo } from "./helpers";

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

    const { rewind } = applyWithUndo(
      store,
      { cards: { $elemMatch: { id: "card-2" } } },
      { $set: { "cards.$.title": "Two!" } },
    );

    expect(store.cards[1]!.title).toBe("Two!");
    expect(store.cards[0]!.title).toBe("One");
    rewind();
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

    const { rewind } = applyWithUndo(
      store,
      { cards: { $elemMatch: { votes: { $gte: 5 } } } },
      { $set: { "cards.$.done": true } },
    );

    // card-3 is the first with votes >= 5.
    expect(store.cards.map((c) => c.done)).toEqual([false, false, true]);
    rewind();
  });
});

describe("positional $ — dotted-field query", () => {
  it("resolves $ from a dotted equality condition", () => {
    const store = createReactive(board());

    const { rewind } = applyWithUndo(
      store,
      { "cards.id": "card-2" },
      { $set: { "cards.$.done": true } },
    );

    expect(store.cards.map((c) => c.done)).toEqual([false, true, false]);
    rewind();
  });
});

describe("positional $ — array of primitives", () => {
  it("resolves $ from a whole-element equality condition", () => {
    const store = createReactive({ nums: [1, 2, 3] });

    const { rewind } = applyWithUndo(store, { nums: 2 }, { $set: { "nums.$": 20 } });

    expect(store.nums).toEqual([1, 20, 3]);
    rewind();
  });

  it("throws when the query says nothing about the array (Mongo requires it)", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() => update(store, {}, { $inc: { "nums.$": 100 } })).toThrow(
      /did not find the match needed from the query/i,
    );
  });

  it("throws when no element matches the query condition", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() => update(store, { nums: 99 }, { $set: { "nums.$": 1 } })).toThrow(
      /did not find the match needed from the query/i,
    );
  });
});

describe("positional $ — Mongo semantics", () => {
  it("updates only the first matching element", () => {
    const store = createReactive({ nums: [5, 1, 5, 1] });
    const { rewind } = applyWithUndo(store, { nums: 5 }, { $set: { "nums.$": 99 } });
    // Only the first 5 (index 0) is updated, not index 2.
    expect(store.nums).toEqual([99, 1, 5, 1]);
    rewind();
  });

  it("selects by one field and updates another (the grades example)", () => {
    const store = createReactive({
      _id: 4,
      grades: [
        { grade: 80, mean: 75, std: 8 },
        { grade: 85, mean: 90, std: 5 },
        { grade: 90, mean: 85, std: 3 },
      ],
    });
    // db.students.updateOne({ _id: 4, "grades.grade": 85 }, { $set: { "grades.$.std": 6 } })
    const { rewind } = applyWithUndo(
      store,
      { _id: 4, "grades.grade": 85 },
      { $set: { "grades.$.std": 6 } },
    );
    expect(store.grades[1]!.std).toBe(6);
    expect(store.grades.map((g) => g.std)).toEqual([8, 6, 3]);
    rewind();
  });

  it("ignores query fields unrelated to the array when resolving $", () => {
    const store = createReactive({ owner: "ada", items: [{ id: "a" }, { id: "b" }] });
    const { rewind } = applyWithUndo(
      store,
      { owner: "ada", "items.id": "b" },
      { $set: { "items.$.id": "B" } },
    );
    expect(store.items.map((i) => i.id)).toEqual(["a", "B"]);
    rewind();
  });

  it("removes the matched element's field with $unset", () => {
    const store = createReactive({
      items: [
        { id: "a", tmp: 1 },
        { id: "b", tmp: 2 },
      ],
    });
    const { rewind } = applyWithUndo(store, { "items.id": "b" }, { $unset: { "items.$.tmp": "" } });
    expect("tmp" in store.items[1]!).toBe(false);
    expect(store.items[0]!.tmp).toBe(1);
    rewind();
  });
});

describe("positional $[] — all elements", () => {
  it("updates a field on every element", () => {
    const store = createReactive(board());

    const { rewind } = applyWithUndo(store, {}, { $set: { "cards.$[].done": true } });

    expect(store.cards.every((c) => c.done)).toBe(true);
    rewind();
  });

  it("produces an undo that restores every element", () => {
    const store = createReactive(board());

    const { undo } = update(store, {}, { $inc: { "cards.$[].votes": 10 } });
    expect(store.cards.map((c) => c.votes)).toEqual([10, 13, 17]);

    update(store, {}, undo);
    expect(store.cards.map((c) => c.votes)).toEqual([0, 3, 7]);
  });
});

// =============================================================================
// Filtered positional $[<identifier>] — driven by the 4th `arrayFilters` option
// (MongoDB-style options object).
// =============================================================================

describe("positional $[<identifier>] — arrayFilters", () => {
  it("updates every element matching the filter", () => {
    const store = createReactive({
      grades: [
        { grade: 80, mean: 75 },
        { grade: 95, mean: 88 },
        { grade: 92, mean: 90 },
      ],
    });

    const { rewind } = applyWithUndo(
      store,
      {},
      { $set: { "grades.$[high].mean": 100 } },
      { arrayFilters: [{ "high.grade": { $gte: 90 } }] },
    );

    expect(store.grades.map((g) => g.mean)).toEqual([75, 100, 100]);
    rewind();
  });

  it("matches a scalar array with a bare-identifier filter", () => {
    const store = createReactive({ nums: [1, 9, 3, 12] });

    const { rewind } = applyWithUndo(
      store,
      {},
      { $inc: { "nums.$[big]": 100 } },
      { arrayFilters: [{ big: { $gte: 9 } }] },
    );

    expect(store.nums).toEqual([1, 109, 3, 112]);
    rewind();
  });

  it("supports multiple identifiers in one update", () => {
    const store = createReactive({ scores: [1, 5, 10, 50] });

    const { rewind } = applyWithUndo(
      store,
      {},
      { $set: { "scores.$[lo]": 0 }, $inc: { "scores.$[hi]": 1000 } },
      { arrayFilters: [{ lo: { $lt: 5 } }, { hi: { $gte: 10 } }] },
    );

    expect(store.scores).toEqual([0, 5, 1010, 1050]);
    rewind();
  });

  it("produces an undo that reverses a filtered update exactly", () => {
    const store = createReactive({
      items: [
        { id: "a", done: false },
        { id: "b", done: false },
        { id: "c", done: false },
      ],
    });

    const { undo } = update(
      store,
      {},
      { $set: { "items.$[pending].done": true } },
      { arrayFilters: [{ "pending.done": false }] },
    );
    expect(store.items.map((i) => i.done)).toEqual([true, true, true]);

    update(store, {}, undo);
    expect(store.items.map((i) => i.done)).toEqual([false, false, false]);
  });

  it("throws when an identifier has no matching arrayFilter", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() =>
      update(store, {}, { $set: { "nums.$[x]": 0 } }, { arrayFilters: [{ y: { $gt: 0 } }] }),
    ).toThrow(/no array filter found for identifier "x"/i);
  });

  it("throws when a supplied arrayFilter is never used", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() =>
      update(
        store,
        {},
        { $set: { "nums.$[a]": 0 } },
        { arrayFilters: [{ a: { $gt: 0 } }, { unused: { $lt: 0 } }] },
      ),
    ).toThrow(/array filter for identifier "unused" was not used/i);
  });

  it("throws when $[identifier] is used with no arrayFilters supplied", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() => update(store, {}, { $set: { "nums.$[x]": 0 } })).toThrow(
      /no array filter found for identifier "x"/i,
    );
  });

  it("treats an empty arrayFilter as an unused filter", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() =>
      update(store, {}, { $set: { "nums.$[a]": 0 } }, { arrayFilters: [{ a: { $gt: 0 } }, {}] }),
    ).toThrow(/array filter for identifier "" was not used/i);
  });

  it("throws when two arrayFilters share the same identifier", () => {
    const store = createReactive({ nums: [1, 2, 3] });
    expect(() =>
      update(
        store,
        {},
        { $set: { "nums.$[a]": 0 } },
        { arrayFilters: [{ a: { $gt: 0 } }, { a: { $lt: 2 } }] },
      ),
    ).toThrow(/multiple array filters with the same top-level field name "a"/i);
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
// each query operator can be pinned to the element it selects. Also verifies the
// undo round-trips the store back to its initial state.
function firstMatchedName(query: any): string {
  const initial = items();
  const store = createReactive(structuredClone(initial));
  const { undo } = update(store, query, { $set: { "items.$.name": "MATCHED" } });
  const index = store.items.findIndex((i) => i.name === "MATCHED");
  update(store, {}, undo);
  expect(unwrap(store)).toEqual(initial);
  return String(index);
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
    const { rewind } = applyWithUndo(
      store,
      { items: { $elemMatch: { meta: { k: 2 } } } },
      { $set: { "items.$.meta.k": 99 } },
    );
    expect(store.items.map((i) => i.meta.k)).toEqual([1, 99]);
    rewind();
  });

  it("resolves $ from a deeply dotted field query", () => {
    const store = createReactive({
      items: [{ meta: { k: 1 } }, { meta: { k: 2 } }],
    });
    const { rewind } = applyWithUndo(
      store,
      { "items.meta.k": 2 },
      { $set: { "items.$.meta.k": 99 } },
    );
    expect(store.items.map((i) => i.meta.k)).toEqual([1, 99]);
    rewind();
  });
});

describe("positional $ at the document root (array document)", () => {
  it("throws for $ on a root array — a root array can't appear in a query", () => {
    const doc: Array<number> = [1, 2, 3];
    expect(() => update(doc, {}, { $set: { $: 9 } })).toThrow(
      /did not find the match needed from the query/i,
    );
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
