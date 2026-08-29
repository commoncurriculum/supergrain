// Property-based coverage for the handle statechart (`src/transitions.ts`).
//
// `applyEvent` is an exhaustive reducer over a tagged event alphabet, and the
// interesting claims it makes are universally quantified over *sequences*:
// `status` is always derived, never stored; a stale-generation event is a
// no-op whatever the handle looks like; `lastError` never lags `error`. The
// unit tests drive each event once — these drive arbitrary interleavings.

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AdapterError } from "../src";
import { applyEvent, HandleEvent, makeIdleHandle, type InternalHandle } from "../src/transitions";

function err(id: number): AdapterError {
  return new AdapterError({ type: "user", keys: [String(id)], cause: new Error(`boom ${id}`) });
}

type EventSpec =
  | { kind: "fetch" }
  | { kind: "insert"; value: number }
  | { kind: "settled"; stale: boolean }
  | { kind: "retrying"; id: number; stale: boolean }
  | { kind: "failed"; id: number; stale: boolean }
  | { kind: "aborted"; stamped: boolean; stale: boolean }
  | { kind: "reset" };

const eventSpecArbitrary: fc.Arbitrary<EventSpec> = fc.oneof(
  fc.constant<EventSpec>({ kind: "fetch" }),
  fc.record({ kind: fc.constant<"insert">("insert"), value: fc.integer({ min: 1, max: 999 }) }),
  fc.record({ kind: fc.constant<"settled">("settled"), stale: fc.boolean() }),
  fc.record({
    kind: fc.constant<"retrying">("retrying"),
    id: fc.integer({ min: 1, max: 99 }),
    stale: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant<"failed">("failed"),
    id: fc.integer({ min: 1, max: 99 }),
    stale: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant<"aborted">("aborted"),
    stamped: fc.boolean(),
    stale: fc.boolean(),
  }),
  fc.constant<EventSpec>({ kind: "reset" }),
);

/**
 * Build the concrete event. A `stale` spec deliberately stamps a generation
 * that cannot be current, so the fence has to drop it.
 */
function toEvent(spec: EventSpec, handle: InternalHandle<unknown>) {
  const current = handle.generation;
  const stamp = (stale: boolean) => (stale ? current + 1000 : current);
  switch (spec.kind) {
    case "fetch": {
      return HandleEvent.fetch();
    }
    case "insert": {
      return HandleEvent.insert(spec.value);
    }
    case "settled": {
      return HandleEvent.settled(stamp(spec.stale));
    }
    case "retrying": {
      return HandleEvent.retrying(err(spec.id), stamp(spec.stale));
    }
    case "failed": {
      return HandleEvent.failed(err(spec.id), stamp(spec.stale));
    }
    case "aborted": {
      return spec.stamped ? HandleEvent.aborted(stamp(spec.stale)) : HandleEvent.aborted();
    }
    case "reset": {
      return HandleEvent.reset();
    }
  }
}

/** The observable flat fields, for "did this event change anything?" checks. */
function snapshot(handle: InternalHandle<unknown>) {
  return {
    value: handle.value,
    error: handle.error,
    isFetching: handle.isFetching,
    fetchedAt: handle.fetchedAt,
    failureCount: handle.failureCount,
    lastError: handle.lastError,
    status: handle.status,
    generation: handle.generation,
    promise: handle.promise,
  };
}

function deriveStatus(value: unknown, error: unknown): string {
  if (value !== undefined) return "success";
  if (error !== undefined) return "error";
  return "pending";
}

const sequenceArbitrary = fc.array(eventSpecArbitrary, { maxLength: 30 });

describe("applyEvent — invariants over arbitrary event sequences", () => {
  it("never throws", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          expect(() => applyEvent(handle, toEvent(spec, handle))).not.toThrow();
        }
      }),
      { numRuns: 300 },
    );
  });

  it("`status` is always derived from value/error, never stored independently", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          applyEvent(handle, toEvent(spec, handle));
          expect(handle.status).toBe(deriveStatus(handle.value, handle.error));
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a terminal `Failed` always leaves `lastError` equal to `error`", () => {
    // `lastError` tracks the current cycle, `error` the last completed one, so
    // they diverge legitimately once a new Fetch starts (see below). What must
    // always hold is that the moment a failure becomes terminal, `lastError`
    // reports it too rather than a stale earlier attempt.
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          const event = toEvent(spec, handle);
          const fenced =
            "generation" in event &&
            event.generation !== undefined &&
            event.generation !== handle.generation;
          applyEvent(handle, event);
          if (event._tag === "Failed" && !fenced) {
            expect(handle.error).toBe(event.error);
            expect(handle.lastError).toBe(event.error);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("`lastError` is only ever the current cycle's — never one from a dead cycle", () => {
    // `Retrying` describes an attempt of a fetch that is still in flight. If no
    // fetch is in flight, `lastError` must not move.
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          const event = toEvent(spec, handle);
          const before = {
            wasFetching: handle.isFetching,
            lastError: handle.lastError,
            failureCount: handle.failureCount,
          };
          applyEvent(handle, event);
          if (event._tag === "Retrying" && !before.wasFetching) {
            expect(handle.lastError).toBe(before.lastError);
            expect(handle.failureCount).toBe(before.failureCount);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("`failureCount` is a non-negative tally that only `Retrying` increments", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          const before = handle.failureCount;
          const event = toEvent(spec, handle);
          applyEvent(handle, event);
          expect(handle.failureCount).toBeGreaterThanOrEqual(0);
          if (event._tag !== "Retrying") {
            expect(handle.failureCount).toBeLessThanOrEqual(before);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("a cycle-ending event always ends activity", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          const event = toEvent(spec, handle);
          const fenced =
            "generation" in event &&
            event.generation !== undefined &&
            event.generation !== handle.generation;
          applyEvent(handle, event);
          if (!fenced && ["Settled", "Failed", "Aborted"].includes(event._tag)) {
            expect(handle.isFetching).toBe(false);
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it("`Fetch` always marks activity and starts a fresh failure tally", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) {
          applyEvent(handle, toEvent(spec, handle));
        }
        const generationBefore = handle.generation;

        applyEvent(handle, HandleEvent.fetch());

        expect(handle.isFetching).toBe(true);
        expect(handle.failureCount).toBe(0);
        expect(handle.lastError).toBeUndefined();
        expect(handle.generation).toBe(generationBefore + 1);
      }),
      { numRuns: 300 },
    );
  });

  it("`Fetch` preserves value and error — stale-while-revalidate", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

        const { value, error } = handle;
        applyEvent(handle, HandleEvent.fetch());

        expect(handle.value).toBe(value);
        expect(handle.error).toBe(error);
        // The new cycle starts with a clean attempt tally, though — `lastError`
        // describes the cycle in flight, `error` the last completed one.
        expect(handle.lastError).toBeUndefined();
        expect(handle.failureCount).toBe(0);
      }),
      { numRuns: 300 },
    );
  });
});

describe("applyEvent — generation fencing", () => {
  it("a stale-stamped event is a total no-op, whatever the handle looks like", () => {
    fc.assert(
      fc.property(
        sequenceArbitrary,
        fc.oneof(
          fc.record({ kind: fc.constant<"settled">("settled"), stale: fc.constant(true) }),
          fc.record({
            kind: fc.constant<"retrying">("retrying"),
            id: fc.integer({ min: 1, max: 99 }),
            stale: fc.constant(true),
          }),
          fc.record({
            kind: fc.constant<"failed">("failed"),
            id: fc.integer({ min: 1, max: 99 }),
            stale: fc.constant(true),
          }),
          fc.record({
            kind: fc.constant<"aborted">("aborted"),
            stamped: fc.constant(true),
            stale: fc.constant(true),
          }),
        ) as fc.Arbitrary<EventSpec>,
        (specs, staleSpec) => {
          const handle = makeIdleHandle();
          for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

          const before = snapshot(handle);
          applyEvent(handle, toEvent(staleSpec, handle));

          expect(snapshot(handle)).toEqual(before);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("an unstamped `Aborted` always applies, however many cycles have passed", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

        applyEvent(handle, HandleEvent.aborted());

        expect(handle.isFetching).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe("applyEvent — Insert and Reset", () => {
  it("`Insert` records the value and clears any error", () => {
    fc.assert(
      fc.property(sequenceArbitrary, fc.integer({ min: 1, max: 999 }), (specs, value) => {
        const handle = makeIdleHandle();
        for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

        applyEvent(handle, HandleEvent.insert(value));

        expect(handle.value).toBe(value);
        expect(handle.error).toBeUndefined();
        expect(handle.status).toBe("success");
        expect(handle.failureCount).toBe(0);
        expect(handle.lastError).toBeUndefined();
      }),
      { numRuns: 300 },
    );
  });

  it("`Insert` of undefined is a no-op, leaving the handle free to settle as Failed", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

        const before = snapshot(handle);
        applyEvent(handle, HandleEvent.insert(undefined));

        expect(snapshot(handle)).toEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it("`Reset` clears the memory fields and is idempotent", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

        applyEvent(handle, HandleEvent.reset());
        expect(handle.value).toBeUndefined();
        expect(handle.error).toBeUndefined();
        expect(handle.fetchedAt).toBeUndefined();
        expect(handle.failureCount).toBe(0);
        expect(handle.lastError).toBeUndefined();
        expect(handle.status).toBe("pending");

        const afterFirst = snapshot(handle);
        applyEvent(handle, HandleEvent.reset());
        expect(snapshot(handle)).toEqual(afterFirst);
      }),
      { numRuns: 300 },
    );
  });

  it("`Reset` leaves an in-flight fetch running", () => {
    fc.assert(
      fc.property(sequenceArbitrary, (specs) => {
        const handle = makeIdleHandle();
        for (const spec of specs) applyEvent(handle, toEvent(spec, handle));
        applyEvent(handle, HandleEvent.fetch());

        applyEvent(handle, HandleEvent.reset());

        expect(handle.isFetching).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("applyEvent — promise lifecycle", () => {
  it("an Insert consumes the resolvers, so nothing can settle the promise twice", async () => {
    await fc.assert(
      fc.asyncProperty(
        sequenceArbitrary,
        fc.integer({ min: 1, max: 999 }),
        async (specs, value) => {
          const handle = makeIdleHandle();
          for (const spec of specs) applyEvent(handle, toEvent(spec, handle));

          applyEvent(handle, HandleEvent.fetch());
          applyEvent(handle, HandleEvent.insert(value));

          // The resolvers are spent, so a later Failed cannot reject a promise
          // that already resolved. Note the promise keeps its FIRST resolution
          // rather than tracking `value` — a refetch must not re-suspend a
          // component that already rendered (see "does not replace an existing
          // in-flight promise on a second fetch" in transitions.test.ts).
          expect(handle.resolve).toBeUndefined();
          expect(handle.reject).toBeUndefined();
          await expect(handle.promise).resolves.toEqual(expect.any(Number));
          expect(handle.value).toBe(value);
        },
      ),
      { numRuns: 150 },
    );
  });

  it("a first-load failure rejects the pending promise with the recorded error", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 99 }), async (id) => {
        const handle = makeIdleHandle();
        applyEvent(handle, HandleEvent.fetch());
        const failure = err(id);
        applyEvent(handle, HandleEvent.failed(failure, handle.generation));

        expect(handle.error).toBe(failure);
        await expect(handle.promise).rejects.toBe(failure);
      }),
      { numRuns: 100 },
    );
  });

  it("a refetch failure after a success leaves the resolved promise intact", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 999 }),
        fc.integer({ min: 1, max: 99 }),
        async (value, id) => {
          const handle = makeIdleHandle();
          applyEvent(handle, HandleEvent.fetch());
          applyEvent(handle, HandleEvent.insert(value));
          const resolved = handle.promise;

          applyEvent(handle, HandleEvent.fetch());
          applyEvent(handle, HandleEvent.failed(err(id), handle.generation));

          expect(handle.promise).toBe(resolved);
          await expect(handle.promise).resolves.toBe(value);
          // The stale value survives the refetch error.
          expect(handle.value).toBe(value);
          expect(handle.status).toBe("success");
        },
      ),
      { numRuns: 150 },
    );
  });
});
