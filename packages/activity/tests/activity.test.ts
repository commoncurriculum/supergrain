import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activityMachine, type ActivityEmitted } from "../src/machines/activity";
import { spawnTestActor } from "./helpers";

function spawn(
  input: {
    idleAfterMs?: number;
    longIdleAfterMs?: number;
    longBlurMs?: number;
  } = {},
) {
  return spawnTestActor<typeof activityMachine, ActivityEmitted>(activityMachine, {
    idleAfterMs: 15_000,
    longIdleAfterMs: 900_000,
    longBlurMs: 120_000,
    ...input,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
});

afterEach(() => {
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

  it("hidden → active on FOCUS within longBlurMs (no longBlurReturn)", () => {
    const { actor, emitted } = spawn({ longBlurMs: 120_000 });
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(60_000);
    actor.send({ type: "FOCUS" });
    expect(actor.getSnapshot().value).toBe("active");
    expect(emitted.find((e) => e.type === "longBlurReturn")).toBeUndefined();
  });

  it("emits longBlurReturn when FOCUS arrives after longBlurMs", () => {
    const { actor, emitted } = spawn({ longBlurMs: 120_000 });
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(120_001);
    actor.send({ type: "FOCUS" });
    expect(actor.getSnapshot().value).toBe("active");
    const longBlur = emitted.find((e) => e.type === "longBlurReturn");
    expect(longBlur).toBeDefined();
    expect((longBlur as { blurDurationMs: number }).blurDurationMs).toBeGreaterThanOrEqual(120_000);
  });

  it("hidden region transitions recent → long after longBlurMs", () => {
    const { actor } = spawn({ longBlurMs: 120_000 });
    actor.send({ type: "BLUR" });
    expect(actor.getSnapshot().matches({ hidden: "recent" })).toBe(true);
    vi.advanceTimersByTime(120_001);
    expect(actor.getSnapshot().matches({ hidden: "long" })).toBe(true);
  });

  it("re-entering hidden resets the long-blur timer", () => {
    const { actor } = spawn({ longBlurMs: 120_000 });
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(60_000);
    actor.send({ type: "FOCUS" });
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(60_000);
    expect(actor.getSnapshot().matches({ hidden: "recent" })).toBe(true);
  });

  it("USER_INPUT while hidden is ignored", () => {
    const { actor } = spawn();
    actor.send({ type: "BLUR" });
    actor.send({ type: "USER_INPUT" });
    expect(actor.getSnapshot().matches("hidden")).toBe(true);
  });
});

describe("ActivityMachine — long idle (the idle-disconnect threshold)", () => {
  it("idle → idle.long after longIdleAfterMs, emitting longIdle", () => {
    const { actor, emitted } = spawn({
      idleAfterMs: 1_000,
      longIdleAfterMs: 5_000,
    });
    vi.advanceTimersByTime(1_000);
    expect(actor.getSnapshot().matches({ idle: "recent" })).toBe(true);
    expect(emitted.find((e) => e.type === "longIdle")).toBeUndefined();

    vi.advanceTimersByTime(5_000);
    expect(actor.getSnapshot().matches({ idle: "long" })).toBe(true);
    expect(emitted.filter((e) => e.type === "longIdle")).toHaveLength(1);
  });

  it("short idle alone NEVER emits longIdle", () => {
    const { actor, emitted } = spawn({
      idleAfterMs: 1_000,
      longIdleAfterMs: 5_000,
    });
    vi.advanceTimersByTime(1_000); // → idle
    vi.advanceTimersByTime(4_999); // just under the long-idle threshold
    actor.send({ type: "USER_INPUT" });
    expect(actor.getSnapshot().value).toBe("active");
    expect(emitted.find((e) => e.type === "longIdle")).toBeUndefined();
  });

  it("USER_INPUT from idle.long returns to active", () => {
    const { actor } = spawn({ idleAfterMs: 1_000, longIdleAfterMs: 2_000 });
    vi.advanceTimersByTime(3_000);
    expect(actor.getSnapshot().matches({ idle: "long" })).toBe(true);
    actor.send({ type: "USER_INPUT" });
    expect(actor.getSnapshot().value).toBe("active");
  });

  it("hidden → hidden.dormant after longIdleAfterMs, emitting longIdle", () => {
    const { actor, emitted } = spawn({
      longBlurMs: 2_000,
      longIdleAfterMs: 5_000,
    });
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(2_000);
    expect(actor.getSnapshot().matches({ hidden: "long" })).toBe(true);
    expect(emitted.find((e) => e.type === "longIdle")).toBeUndefined();

    vi.advanceTimersByTime(3_000); // 5s total hidden
    expect(actor.getSnapshot().matches({ hidden: "dormant" })).toBe(true);
    expect(emitted.filter((e) => e.type === "longIdle")).toHaveLength(1);
  });

  it("FOCUS from hidden.dormant returns to active with longBlurReturn", () => {
    const { actor, emitted } = spawn({
      longBlurMs: 2_000,
      longIdleAfterMs: 5_000,
    });
    actor.send({ type: "BLUR" });
    vi.advanceTimersByTime(5_000);
    actor.send({ type: "FOCUS" });
    expect(actor.getSnapshot().value).toBe("active");
    const ret = emitted.find((e) => e.type === "longBlurReturn");
    expect((ret as { blurDurationMs: number }).blurDurationMs).toBeGreaterThanOrEqual(5_000);
  });
});

describe("ActivityMachine — emission ordering", () => {
  it("emits state events in the order entered", () => {
    const { actor, emitted } = spawn({ idleAfterMs: 1_000, longBlurMs: 60_000 });

    vi.advanceTimersByTime(1_001); // active → idle
    actor.send({ type: "BLUR" }); // idle → hidden
    vi.advanceTimersByTime(60_001); // hidden.recent → hidden.long (no emit)
    actor.send({ type: "FOCUS" }); // hidden.long → active + longBlurReturn

    // Per XState/SCXML ordering, transition actions run before target entry,
    // so longBlurReturn fires before the active entry emit.
    expect(emitted.map((e) => e.type)).toEqual([
      "active",
      "idle",
      "hidden",
      "longBlurReturn",
      "active",
    ]);
  });
});
