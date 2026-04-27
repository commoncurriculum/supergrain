import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import {
  HAS_GC,
  assertGcAvailable,
  delay,
  expectCollectible,
  expectRetainedHeapBudget,
} from "@supergrain/test-utils/memory";
import { describe, it } from "vitest";

import { createQuery, type QueryAdapter } from "../../src";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PlanbookRef {
  type: string;
  id: string;
  offset: number;
}

type Models = {
  planbooks_for_user: {
    id: string;
    type: "planbooks_for_user";
    results: Array<PlanbookRef>;
    nextOffset: number | null;
  };
  planbook: { id: string; type: "planbook"; title?: string };
};

function makeStore(): DocumentStore<Models> {
  return createDocumentStore<Models>({
    models: {
      planbooks_for_user: { adapter: { find: () => Promise.resolve({ data: [] }) } },
      planbook: { adapter: { find: () => Promise.resolve({ data: [] }) } },
    },
  });
}

function makeRefs(seed: number, width = 16): Array<PlanbookRef> {
  return Array.from({ length: width }, (_, index) => ({
    type: "planbook",
    id: `pb-${seed}-${index}`,
    offset: index,
  }));
}

it("GC is exposed (required for all queries memory tests)", () => {
  assertGcAvailable();
});

describe.runIf(HAS_GC)("queries memory", () => {
  it("collects a destroyed query and its store after refetch resolves", async () => {
    await expectCollectible(async () => {
      const store = makeStore();
      const fetched = deferred<{
        data: { results: Array<PlanbookRef> };
        meta: { nextOffset: number | null };
      }>();
      const adapter: QueryAdapter<PlanbookRef> = {
        fetch: () => fetched.promise,
      };
      const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u1" });
      void q.refetch();
      return {
        targets: [store as object, q as object],
        teardown: () => q.destroy(),
        settle: async () => {
          fetched.resolve({ data: { results: makeRefs(1) }, meta: { nextOffset: null } });
          await delay();
        },
      };
    });
  });

  // Live-subscription leak surface: createQuery accepts a `subscribe` hook and
  // calls the returned unsub on destroy(). If destroy() doesn't release the
  // closure, the registered onInvalidate callback (which holds fetchPage,
  // which holds the store + adapter) leaks.
  it("collects a destroyed query that registered a live subscription", async () => {
    await expectCollectible(async () => {
      const store = makeStore();
      const adapter: QueryAdapter<PlanbookRef> = {
        fetch: () =>
          Promise.resolve({
            data: { results: makeRefs(2) },
            meta: { nextOffset: null },
          }),
      };
      const subscribers = new Set<() => void>();
      const q = createQuery({
        store,
        adapter,
        type: "planbooks_for_user",
        id: "u2",
        subscribe: (_type, _id, onInvalidate) => {
          subscribers.add(onInvalidate);
          return () => subscribers.delete(onInvalidate);
        },
      });
      void q.refetch();
      return {
        targets: [store as object, q as object],
        teardown: () => q.destroy(),
        settle: async () => {
          await delay();
        },
      };
    });
  });

  // Targeted listener-accumulation test: many queries against one shared
  // subscriber registry. If destroy() ever fails to fire unsub, the registry
  // keeps growing and the resulting closures pin the store + adapter.
  it("does not accumulate live subscribers across many query lifecycles", async () => {
    await expectRetainedHeapBudget(async () => {
      const store = makeStore();
      const subscribers = new Set<() => void>();
      const adapter: QueryAdapter<PlanbookRef> = {
        fetch: () =>
          Promise.resolve({
            data: { results: [] as Array<PlanbookRef> },
            meta: { nextOffset: null },
          }),
      };
      for (let index = 0; index < 200; index++) {
        const q = createQuery({
          store,
          adapter,
          type: "planbooks_for_user",
          id: `u-${index}`,
          subscribe: (_type, _id, onInvalidate) => {
            subscribers.add(onInvalidate);
            return () => subscribers.delete(onInvalidate);
          },
        });
        await q.refetch();
        q.destroy();
      }
      // After all queries are destroyed, the registry should be empty — any
      // residual entries are listener leaks.
      if (subscribers.size > 0) {
        throw new Error(
          `Expected 0 live subscribers after 200 destroyed queries, found ${subscribers.size}`,
        );
      }
      await delay();
    }, 3_500_000);
  });

  // Destroy mid-fetch: the racy case. Pending fetch resolves AFTER destroy().
  // The destroyed flag must short-circuit the result write so nothing in the
  // closure pins the store.
  it("collects a query destroyed before its in-flight fetch resolves", async () => {
    await expectCollectible(async () => {
      const store = makeStore();
      const fetched = deferred<{
        data: { results: Array<PlanbookRef> };
        meta: { nextOffset: number | null };
      }>();
      const adapter: QueryAdapter<PlanbookRef> = {
        fetch: () => fetched.promise,
      };
      const q = createQuery({ store, adapter, type: "planbooks_for_user", id: "u3" });
      void q.refetch();
      q.destroy();
      return {
        targets: [store as object, q as object],
        settle: async () => {
          fetched.resolve({ data: { results: makeRefs(3) }, meta: { nextOffset: null } });
          await delay();
        },
      };
    });
  });

  it("retained heap stays bounded across 250 create/refetch/destroy cycles", async () => {
    await expectRetainedHeapBudget(async () => {
      const store = makeStore();
      for (let index = 0; index < 250; index++) {
        const adapter: QueryAdapter<PlanbookRef> = {
          fetch: () =>
            Promise.resolve({
              data: { results: makeRefs(index, 8) },
              meta: { nextOffset: null },
            }),
        };
        const q = createQuery({
          store,
          adapter,
          type: "planbooks_for_user",
          id: `pages-${index}`,
        });
        await q.refetch();
        q.destroy();
      }
      await delay();
    }, 5_000_000);
  });
});
