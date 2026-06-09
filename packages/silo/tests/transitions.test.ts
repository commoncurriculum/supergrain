// =============================================================================
// tests/transitions.test.ts
// =============================================================================
//
// Unit tests for the handle statechart in `src/transitions.ts`. `applyEvent`
// is a pure reducer over a tagged event alphabet operating on a flat
// `InternalHandle`; these tests drive it directly on a plain `makeIdleHandle()`
// object (no reactivity needed) so every event and branch — including the
// promise lifecycle — is covered in isolation from the store/finder.
// =============================================================================

import { describe, expect, it } from "vitest";

import { AdapterError } from "../src";
import { applyEvent, HandleEvent, makeIdleHandle } from "../src/transitions";

function err(): AdapterError {
  return new AdapterError({ type: "user", keys: ["1"], cause: new Error("boom") });
}

describe("makeIdleHandle", () => {
  it("starts in a clean pending state", () => {
    const h = makeIdleHandle();
    expect(h.value).toBeUndefined();
    expect(h.error).toBeUndefined();
    expect(h.isFetching).toBe(false);
    expect(h.fetchedAt).toBeUndefined();
    expect(h.status).toBe("pending");
    expect(h.promise).toBeUndefined();
  });
});

describe("applyEvent — fetch()", () => {
  it("marks a fresh handle as fetching, status pending, and creates a promise", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());

    expect(h.isFetching).toBe(true);
    expect(h.value).toBeUndefined();
    expect(h.status).toBe("pending");
    expect(h.promise).toBeInstanceOf(Promise);
  });

  it("does not replace an existing in-flight promise on a second fetch", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    const first = h.promise;
    applyEvent(h, HandleEvent.fetch());
    expect(h.promise).toBe(first);
  });
});

describe("applyEvent — insert(v)", () => {
  it("sets value, fetchedAt, clears error, status success", () => {
    const h = makeIdleHandle();
    const doc = { id: "1" };
    applyEvent(h, HandleEvent.insert(doc));

    expect(h.value).toBe(doc);
    expect(h.fetchedAt).toBeInstanceOf(Date);
    expect(h.error).toBeUndefined();
    expect(h.status).toBe("success");
  });

  it("resolves the pending fetch promise", async () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    const doc = { id: "1" };
    applyEvent(h, HandleEvent.insert(doc));

    await expect(h.promise).resolves.toBe(doc);
  });
});

describe("applyEvent — settled()", () => {
  it("ends activity after an insert", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.insert(7));
    applyEvent(h, HandleEvent.settled());

    expect(h.isFetching).toBe(false);
    expect(h.value).toBe(7);
    expect(h.status).toBe("success");
  });

  it("resolves a still-pending promise when a value is present", async () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    // Simulate a value landing without going through Insert's resolver path.
    h.value = 9;
    h.status = "success";
    applyEvent(h, HandleEvent.settled());

    await expect(h.promise).resolves.toBe(9);
  });
});

describe("applyEvent — failed(err)", () => {
  it("on a fresh handle: records the error, no value, status error, not fetching", async () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    const e = err();
    applyEvent(h, HandleEvent.failed(e));

    expect(h.error).toBe(e);
    expect(h.value).toBeUndefined();
    expect(h.status).toBe("error");
    expect(h.isFetching).toBe(false);
    await expect(h.promise).rejects.toBe(e);
  });

  it("stale-while-revalidate: keeps the value when a refetch fails", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.insert(5));
    const e = err();
    applyEvent(h, HandleEvent.failed(e));

    expect(h.value).toBe(5); // value survives
    expect(h.error).toBe(e);
    expect(h.status).toBe("success"); // value present => success despite error
    expect(h.isFetching).toBe(false);
  });
});

describe("applyEvent — insert after a failed first load", () => {
  it("hands out a NEW resolved promise (no pending resolver)", async () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.failed(err()));
    // Promise already rejected; swallow so it doesn't surface as unhandled.
    await h.promise?.catch(() => {});

    applyEvent(h, HandleEvent.insert(42));

    expect(h.value).toBe(42);
    expect(h.error).toBeUndefined();
    expect(h.status).toBe("success");
    await expect(h.promise).resolves.toBe(42);
  });
});

describe("applyEvent — aborted()", () => {
  it("ends activity without recording an outcome", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.aborted());

    expect(h.isFetching).toBe(false);
    expect(h.value).toBeUndefined();
    expect(h.error).toBeUndefined();
    expect(h.status).toBe("pending");
  });

  it("leaves a pending first-load promise pending for a later fetch to settle", async () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    const inflight = h.promise;

    applyEvent(h, HandleEvent.aborted());
    expect(h.promise).toBe(inflight);

    // A later cycle can still resolve the same promise.
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.insert(11));
    await expect(inflight).resolves.toBe(11);
  });

  it("keeps a stale value and error untouched", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.insert(5));
    const e = err();
    applyEvent(h, HandleEvent.failed(e));

    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.aborted());

    expect(h.value).toBe(5);
    expect(h.error).toBe(e);
    expect(h.status).toBe("success");
    expect(h.isFetching).toBe(false);
  });
});

describe("applyEvent — reset()", () => {
  it("when not fetching: clears everything and drops the promise", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    applyEvent(h, HandleEvent.insert(3));
    applyEvent(h, HandleEvent.settled());

    applyEvent(h, HandleEvent.reset());

    expect(h.value).toBeUndefined();
    expect(h.error).toBeUndefined();
    expect(h.fetchedAt).toBeUndefined();
    expect(h.status).toBe("pending");
    expect(h.promise).toBeUndefined();
  });

  it("while fetching: clears value but keeps the in-flight fetch and promise", () => {
    const h = makeIdleHandle();
    applyEvent(h, HandleEvent.fetch());
    const inflight = h.promise;

    applyEvent(h, HandleEvent.reset());

    expect(h.value).toBeUndefined();
    expect(h.isFetching).toBe(true);
    expect(h.promise).toBe(inflight);
  });
});
