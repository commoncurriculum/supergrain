import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { createReactive, effect, startBatch, endBatch } from "../../src";
import { enableProfiling, disableProfiling, resetProfiler, getProfile } from "../../src/profiler";

describe("Profiler", () => {
  beforeEach(() => {
    enableProfiling();
    resetProfiler();
  });

  afterEach(() => {
    disableProfiling();
  });

  describe("signalReads and signalSkips", () => {
    it("counts reads with a subscriber as signalReads", () => {
      const store = createReactive({ x: 1 });
      effect(() => {
        void store.x;
      });
      const p = getProfile();
      expect(p.signalReads).toBe(1);
      expect(p.signalSkips).toBe(0);
    });

    it("counts reads without a subscriber as signalSkips", () => {
      const store = createReactive({ x: 1 });
      // Read outside any effect — no subscriber
      void store.x;
      const p = getProfile();
      expect(p.signalSkips).toBe(1);
      expect(p.signalReads).toBe(0);
    });

    it("counts proxy reads in a find loop as skips", () => {
      const store = createReactive({
        data: [{ id: 1 }, { id: 2 }, { id: 3 }],
      });
      // Access data to create the signal (inside an effect to warm up)
      effect(() => {
        void store.data;
      });
      resetProfiler();

      // find() outside an effect — all reads should be skips
      store.data.find((d: any) => d.id === 2);
      const p = getProfile();
      expect(p.signalReads).toBe(0);
      expect(p.signalSkips).toBeGreaterThan(0);
    });
  });

  describe("signalWrites", () => {
    it("counts property mutations when signal exists", () => {
      const store = createReactive({ x: 1, y: 2 });
      // Create the signal by reading inside an effect
      effect(() => void store.x);
      resetProfiler();

      store.x = 10;
      const p = getProfile();
      expect(p.signalWrites).toBe(1);
    });

    it("counts batched mutations individually", () => {
      const store = createReactive({
        data: [{ label: "a" }, { label: "b" }, { label: "c" }],
      });
      // Warm up signals
      effect(() => {
        for (const item of store.data) {
          void item.label;
        }
      });
      resetProfiler();

      startBatch();
      store.data[0]!.label = "A";
      store.data[1]!.label = "B";
      store.data[2]!.label = "C";
      endBatch();
      const p = getProfile();
      expect(p.signalWrites).toBe(3);
    });

    it("does not count no-op writes (same value)", () => {
      const store = createReactive({ x: 1 });
      store.x = 1; // same value
      const p = getProfile();
      expect(p.signalWrites).toBe(0);
    });
  });

  describe("fine-grained reactivity", () => {
    it("only fires affected effects on select (1 of 3)", () => {
      const store = createReactive({
        data: [
          { id: 1, label: "a", isSelected: false },
          { id: 2, label: "b", isSelected: false },
          { id: 3, label: "c", isSelected: false },
        ],
        selected: null as number | null,
      });

      const spies = store.data.map((_: any, i: number) => {
        const spy = vi.fn();
        effect(() => {
          void store.data[i]!.isSelected;
          void store.data[i]!.label;
          spy();
        });
        return spy;
      });

      // Reset after initial run
      for (const spy of spies) spy.mockClear();

      // Select row 2 — should fire exactly 1 effect
      startBatch();
      const item = store.data.find((d: any) => d.id === 2);
      if (item) item.isSelected = true;
      store.selected = 2;
      endBatch();

      expect(spies[0]).not.toHaveBeenCalled();
      expect(spies[1]).toHaveBeenCalledTimes(1);
      expect(spies[2]).not.toHaveBeenCalled();
    });

    it("only fires affected effects on partial update (10 of 100)", () => {
      const count = 100;
      const store = createReactive({
        data: Array.from({ length: count }, (_, i) => ({
          id: i + 1,
          label: `Item ${i + 1}`,
        })),
      });

      const spies = Array.from({ length: count }, (_, i) => {
        const spy = vi.fn();
        effect(() => {
          void store.data[i]!.label;
          spy();
        });
        return spy;
      });

      for (const spy of spies) spy.mockClear();

      // Update every 10th row
      startBatch();
      for (let i = 0; i < count; i += 10) {
        store.data[i]!.label = store.data[i]!.label + " !!!";
      }
      endBatch();

      const firedCount = spies.filter((s) => s.mock.calls.length > 0).length;
      expect(firedCount).toBe(10);
    });
  });

  describe("disabled by default", () => {
    it("does not count when profiling is disabled", () => {
      disableProfiling();
      resetProfiler();
      const store = createReactive({ x: 1 });
      store.x = 10;
      void store.x;
      const p = getProfile();
      expect(p.signalReads).toBe(0);
      expect(p.signalSkips).toBe(0);
      expect(p.signalWrites).toBe(0);
    });
  });

  describe("resetProfiler", () => {
    it("resets all counters to zero", () => {
      const store = createReactive({ x: 1 });
      effect(() => void store.x);
      store.x = 2;

      const before = getProfile();
      expect(before.signalReads).toBeGreaterThan(0);

      resetProfiler();
      const after = getProfile();
      expect(after.signalReads).toBe(0);
      expect(after.signalSkips).toBe(0);
      expect(after.signalWrites).toBe(0);
    });
  });
});
