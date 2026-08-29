import { createReactive, effect, unwrap } from "@supergrain/kernel";
import { describe, expect, it } from "vitest";

import { $PROXY, $RAW } from "../../src/internal";

/**
 * Dates are proxied, so mutating one in place notifies like any other write.
 *
 * Before this, `store.when.setFullYear(2030)` changed the value and notified
 * nothing — the classic silent-staleness trap, since the read looked correct
 * and the UI simply never updated.
 */
describe("reactive Date", () => {
  it("notifies when a setter changes the time", () => {
    const store = createReactive({ when: new Date("2020-01-01T00:00:00Z") });
    let seen = 0;
    const dispose = effect(() => {
      store.when.getFullYear();
      seen++;
    });
    expect(seen).toBe(1);

    store.when.setFullYear(2030);
    expect(seen).toBe(2);
    expect(store.when.getFullYear()).toBe(2030);
    dispose();
  });

  it("notifies through setTime and the UTC setters", () => {
    const store = createReactive({ when: new Date(0) });
    let seen = 0;
    const dispose = effect(() => {
      store.when.getTime();
      seen++;
    });

    store.when.setTime(1000);
    expect(seen).toBe(2);
    store.when.setUTCMonth(5);
    expect(seen).toBe(3);
    dispose();
  });

  it("does not notify when a setter leaves the time unchanged", () => {
    const store = createReactive({ when: new Date("2020-06-01T00:00:00Z") });
    let seen = 0;
    const dispose = effect(() => {
      store.when.getTime();
      seen++;
    });
    expect(seen).toBe(1);

    // Same value written back: no change, so no notification.
    store.when.setUTCFullYear(2020);
    expect(seen).toBe(1);
    dispose();
  });

  it("does not notify when an invalid date stays invalid", () => {
    const store = createReactive({ when: new Date(Number.NaN) });
    let seen = 0;
    const dispose = effect(() => {
      store.when.getTime();
      seen++;
    });

    // NaN → NaN is not a change; `Object.is` catches what `!==` would miss.
    store.when.setFullYear(Number.NaN);
    expect(seen).toBe(1);
    dispose();
  });

  it("keeps Date identity and behaviour intact", () => {
    const store = createReactive({ when: new Date("2020-01-01T00:00:00Z") });

    expect(store.when instanceof Date).toBe(true);
    expect(Object.prototype.toString.call(store.when)).toBe("[object Date]");
    expect(store.when.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(JSON.stringify({ at: store.when })).toBe('{"at":"2020-01-01T00:00:00.000Z"}');
    expect(Number(store.when)).toBe(Date.UTC(2020, 0, 1));
    expect(`${store.when.getUTCFullYear()}`).toBe("2020");
  });

  it("replacing the Date wholesale still notifies", () => {
    const store = createReactive({ when: new Date(0) });
    let seen = 0;
    const dispose = effect(() => {
      store.when.getTime();
      seen++;
    });

    store.when = new Date(5000);
    expect(seen).toBe(2);
    expect(store.when.getTime()).toBe(5000);
    dispose();
  });

  it("tracks a Date nested deeper in the tree", () => {
    const store = createReactive({ meeting: { starts: new Date(0) } });
    let seen = 0;
    const dispose = effect(() => {
      store.meeting.starts.getTime();
      seen++;
    });

    store.meeting.starts.setTime(90);
    expect(seen).toBe(2);
    dispose();
  });

  it("returns the same proxy for the same Date", () => {
    const store = createReactive({ when: new Date(0) });
    expect(store.when).toBe(store.when);
  });

  it("unwraps to the raw Date and answers the proxy symbols", () => {
    const raw = new Date(0),
      store = createReactive({ when: raw });

    expect(unwrap(store.when)).toBe(raw);
    expect((store.when as unknown as Record<symbol, unknown>)[$RAW]).toBe(raw);
    expect((store.when as unknown as Record<symbol, unknown>)[$PROXY]).toBe(store.when);
  });

  it("reports membership through the has trap", () => {
    const store = createReactive({ when: new Date(0) });

    expect("getTime" in store.when).toBe(true);
    expect("nope" in store.when).toBe(false);
    expect($RAW in (store.when as object)).toBe(true);
    expect($PROXY in (store.when as object)).toBe(true);
  });

  it("does not notify a reader that never touched the Date", () => {
    const store = createReactive({ when: new Date(0), other: 1 });
    let seen = 0;
    const dispose = effect(() => {
      void store.other;
      seen++;
    });

    store.when.setTime(1234);
    expect(seen).toBe(1);
    dispose();
  });
});
