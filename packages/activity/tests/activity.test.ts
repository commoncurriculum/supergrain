import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activityMachine, type ActivityEmitted } from "../src/machines/activity";
import { spawnTestActor } from "./helpers";

// Spawned actors are stopped in afterEach so their pending delayed
// transitions don't leak across the fake↔real timer toggle.
const spawned: Array<{ stop: () => void }> = [];

function spawn(input: { idleAfterMs?: number } = {}) {
  const handle = spawnTestActor<typeof activityMachine, ActivityEmitted>(activityMachine, {
    idleAfterMs: 15_000,
    ...input,
  });
  spawned.push(handle.actor);
  return handle;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
  for (const actor of spawned.splice(0)) actor.stop();
  vi.useRealTimers();
});

describe("ActivityMachine — initial state", () => {
  it("starts in active", () => {
    const { actor } = spawn();
    expect(actor.getSnapshot().value).toBe("active");
  });

  it("emits 'active' on entry", () => {
    const { emitted } = spawn();
    expect(emitted.map((e) => e.type)).toEqual(["active"]);
  });
});

describe("ActivityMachine — active <-> idle", () => {
  it("transitions active → idle after idleAfterMs", () => {
    const { actor, emitted } = spawn({ idleAfterMs: 15_000 });
    vi.advanceTimersByTime(15_000);
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    expect(emitted.map((e) => e.type)).toEqual(["active", "idle"]);
  });

  it("does not transition to idle if USER_INPUT arrives in time", () => {
    const { actor } = spawn({ idleAfterMs: 15_000 });
    vi.advanceTimersByTime(10_000);
    actor.send({ type: "USER_INPUT" });
    vi.advanceTimersByTime(10_000);
    expect(actor.getSnapshot().value).toBe("active");
  });

  it("USER_INPUT in idle returns to active", () => {
    const { actor, emitted } = spawn({ idleAfterMs: 1_000 });
    vi.advanceTimersByTime(1_001);
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    actor.send({ type: "USER_INPUT" });
    expect(actor.getSnapshot().value).toBe("active");
    expect(emitted.map((e) => e.type)).toEqual(["active", "idle", "active"]);
  });

  it("FOCUS in idle returns to active", () => {
    const { actor } = spawn({ idleAfterMs: 1_000 });
    vi.advanceTimersByTime(1_001);
    actor.send({ type: "FOCUS" });
    expect(actor.getSnapshot().value).toBe("active");
  });

  it("repeated USER_INPUT keeps resetting the idle timer", () => {
    const { actor } = spawn({ idleAfterMs: 1_000 });
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900);
      actor.send({ type: "USER_INPUT" });
      expect(actor.getSnapshot().value).toBe("active");
    }
    vi.advanceTimersByTime(1_001);
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });
});

describe("ActivityMachine — hidden region", () => {
  it("active → hidden on BLUR", () => {
    const { actor, emitted } = spawn();
    actor.send({ type: "BLUR" });
    expect(actor.getSnapshot().matches("hidden")).toBe(true);
    expect(emitted.map((e) => e.type)).toEqual(["active", "hidden"]);
  });

  it("idle → hidden on BLUR", () => {
    const { actor } = spawn({ idleAfterMs: 1_000 });
    vi.advanceTimersByTime(1_001);
    actor.send({ type: "BLUR" });
    expect(actor.getSnapshot().matches("hidden")).toBe(true);
  });

  it("hidden → active on FOCUS", () => {
    const { actor, emitted } = spawn();
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(60_000);
    actor.send({ type: "FOCUS" });
    expect(actor.getSnapshot().value).toBe("active");
    expect(emitted.map((e) => e.type)).toEqual(["active", "hidden", "active"]);
  });

  it("USER_INPUT while hidden is ignored", () => {
    const { actor } = spawn();
    actor.send({ type: "BLUR" });
    actor.send({ type: "USER_INPUT" });
    expect(actor.getSnapshot().matches("hidden")).toBe(true);
  });
});

describe("ActivityMachine — emission ordering", () => {
  it("emits state events in the order entered", () => {
    const { actor, emitted } = spawn({ idleAfterMs: 1_000 });

    vi.advanceTimersByTime(1_001); // active → idle
    actor.send({ type: "BLUR" }); // idle → hidden
    actor.send({ type: "FOCUS" }); // hidden → active

    expect(emitted.map((e) => e.type)).toEqual(["active", "idle", "hidden", "active"]);
  });
});
