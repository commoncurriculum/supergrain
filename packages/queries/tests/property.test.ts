// Property-based coverage for `createQuery`'s pagination merge.
//
// The docblock on `createQuery` states three rules: a page-0 non-empty
// response replaces the results wholesale in server order, `fetchNextPage`
// merges by server-provided offset, and an empty response at any offset resets
// to `[]`. Each is a claim about *every* prior state, not the handful the unit
// tests set up — so they're stated here as properties over generated page
// sequences.

import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { Effect, Schedule } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createQuery, type QueryAdapter } from "../src";

interface Ref {
  type: string;
  id: string;
  offset: number;
}

type TypeToModel = {
  refs_for_user: {
    id: string;
    type: "refs_for_user";
    results: Array<Ref>;
    nextOffset: number | null;
  };
  ref: { id: string; type: "ref" };
};

function makeStore(): DocumentStore<TypeToModel> {
  return createDocumentStore<TypeToModel>({
    models: {
      refs_for_user: { adapter: { find: () => Effect.succeed({ data: [] }) } },
      ref: { adapter: { find: () => Effect.succeed({ data: [] }) } },
    },
    retry: Schedule.recurs(0),
  });
}

/** One server page: `count` results starting at `startOffset`, contiguous. */
interface Page {
  count: number;
  nextOffset: number | null;
}

/**
 * An adapter whose next response is set by the test. Records the offset it was
 * asked for so the merge can be checked against what the client requested.
 */
function makeScriptedAdapter(): {
  adapter: QueryAdapter<Ref>;
  setPage: (page: Page) => void;
  lastRequestedOffset: () => number;
} {
  let page: Page = { count: 0, nextOffset: null };
  let requested = 0;
  return {
    adapter: {
      fetch: (_id: string, opts: { offset: number; limit: number; signal: AbortSignal }) => {
        requested = opts.offset;
        const results = Array.from({ length: page.count }, (_, i) => ({
          type: "ref",
          id: `r${opts.offset + i}`,
          offset: opts.offset + i,
        }));
        return Effect.succeed({
          data: { results },
          meta: { nextOffset: page.nextOffset },
          included: undefined as Array<{ type: string; id: string }> | undefined,
        });
      },
    },
    setPage: (next: Page) => {
      page = next;
    },
    lastRequestedOffset: () => requested,
  };
}

/**
 * Every result the server sent sits at its own offset.
 *
 * Note what is deliberately NOT asserted: density. `results` is addressed by
 * server offset, so a server whose offsets skip (an empty page that still
 * reports a further `nextOffset`, or a genuine gap between pages) leaves holes
 * — see "positions results by server offset on later pages (sparse merge)" in
 * create-query.test.ts, which pins exactly that. Callers index by offset rather
 * than iterating blindly.
 */
function expectPositionedByOffset(results: ReadonlyArray<Ref>): void {
  for (let i = 0; i < results.length; i++) {
    // A gap the server left is either a hole or — once a later merge has
    // spread the array — an explicit `undefined`. Both are slots the client
    // was never sent, so neither is checked for an offset.
    const entry = results[i];
    if (entry === undefined) continue;
    expect(entry.offset).toBe(i);
  }
}

const pageArbitrary: fc.Arbitrary<Page> = fc.record({
  count: fc.integer({ min: 0, max: 5 }),
  nextOffset: fc.option(fc.integer({ min: 0, max: 40 }), { nil: null }),
});

describe("createQuery — page 0 replaces wholesale", () => {
  it("a non-empty refetch always yields exactly the server's results, in order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(pageArbitrary, { maxLength: 6 }),
        fc.integer({ min: 1, max: 5 }),
        async (history, finalCount) => {
          const store = makeStore();
          const { adapter, setPage } = makeScriptedAdapter();
          const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

          try {
            for (const page of history) {
              setPage(page);
              await q.refetch();
            }

            setPage({ count: finalCount, nextOffset: null });
            await q.refetch();

            expect(q.results.map((r) => r.id)).toEqual(
              Array.from({ length: finalCount }, (_, i) => `r${i}`),
            );
            expect(q.results.map((r) => r.offset)).toEqual(
              Array.from({ length: finalCount }, (_, i) => i),
            );
            for (let i = 0; i < q.results.length; i++) {
              expect(Object.hasOwn(q.results, String(i))).toBe(true);
            }
          } finally {
            q.destroy();
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("an empty response resets the results to [] from any prior state", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(pageArbitrary, { maxLength: 6 }), async (history) => {
        const store = makeStore();
        const { adapter, setPage } = makeScriptedAdapter();
        const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

        try {
          for (const page of history) {
            setPage(page);
            await q.refetch();
          }

          setPage({ count: 0, nextOffset: null });
          await q.refetch();

          expect(q.results).toEqual([]);
        } finally {
          q.destroy();
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe("createQuery — fetchNextPage merges by offset", () => {
  it("every merged page is readable at its own offsets, and earlier pages survive", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 5 }),
        async (pageSizes) => {
          const store = makeStore();
          const { adapter, setPage, lastRequestedOffset } = makeScriptedAdapter();
          const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

          try {
            // Page 0 establishes the array; each later page is contiguous, as
            // a paginating server produces.
            let served = 0;
            setPage({ count: pageSizes[0]!, nextOffset: pageSizes[0]! });
            await q.refetch();
            served += pageSizes[0]!;

            for (const size of pageSizes.slice(1)) {
              setPage({ count: size, nextOffset: served + size });
              await q.fetchNextPage();
              expect(lastRequestedOffset()).toBe(served);
              served += size;

              // Everything served so far is present at its own offset.
              expect(q.results).toHaveLength(served);
              for (let i = 0; i < served; i++) {
                expect(q.results[i]!.offset).toBe(i);
                expect(q.results[i]!.id).toBe(`r${i}`);
              }
              expectPositionedByOffset(q.results);
            }
          } finally {
            q.destroy();
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it("every result stays readable at its own offset, whatever sequence arrives", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            page: pageArbitrary,
            next: fc.boolean(),
          }),
          { maxLength: 8 },
        ),
        async (steps) => {
          const store = makeStore();
          const { adapter, setPage } = makeScriptedAdapter();
          const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

          try {
            for (const step of steps) {
              setPage(step.page);
              await (step.next ? q.fetchNextPage() : q.refetch());
              expectPositionedByOffset(q.results);
            }
          } finally {
            q.destroy();
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("createQuery — nextOffset and transient state", () => {
  it("nextOffset always mirrors the last response's meta", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(pageArbitrary, { minLength: 1, maxLength: 6 }), async (pages) => {
        const store = makeStore();
        const { adapter, setPage } = makeScriptedAdapter();
        const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

        try {
          for (const page of pages) {
            setPage(page);
            await q.refetch();
            expect(q.nextOffset).toBe(page.nextOffset);
          }
        } finally {
          q.destroy();
        }
      }),
      { numRuns: 60 },
    );
  });

  it("a successful fetch always ends with no error and no activity", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(pageArbitrary, { minLength: 1, maxLength: 6 }), async (pages) => {
        const store = makeStore();
        const { adapter, setPage } = makeScriptedAdapter();
        const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

        try {
          for (const page of pages) {
            setPage(page);
            await q.refetch();
            expect(q.isFetching).toBe(false);
            expect(q.error).toBeUndefined();
            expect(q.failureCount).toBe(0);
            expect(q.lastError).toBeUndefined();
          }
        } finally {
          q.destroy();
        }
      }),
      { numRuns: 60 },
    );
  });

  it("after destroy() no further fetch changes the results", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(pageArbitrary, { maxLength: 4 }), async (pages) => {
        const store = makeStore();
        const { adapter, setPage } = makeScriptedAdapter();
        const q = createQuery({ store, adapter, type: "refs_for_user", id: "u1" });

        for (const page of pages) {
          setPage(page);
          await q.refetch();
        }
        const before = [...q.results];

        q.destroy();
        setPage({ count: 5, nextOffset: 5 });
        await q.refetch();
        await q.fetchNextPage();

        expect(q.results).toEqual(before);
        expect(q.isFetching).toBe(false);
      }),
      { numRuns: 60 },
    );
  });
});
