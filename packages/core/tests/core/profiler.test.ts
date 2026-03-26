import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createStore, startBatch, endBatch } from "../../src";
import {
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
  profiledEffect as effect,
} from "../../src/profiler";

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
      const store = createStore({ x: 1 });
      effect(() => {
        void store.x;
      });
      const p = getProfile();
      expect(p.signalReads).toBe(1);
      expect(p.signalSkips).toBe(0);
    });

    it("counts reads without a subscriber as signalSkips", () => {
      const store = createStore({ x: 1 });
      // Read outside any effect — no subscriber
      void store.x;
      const p = getProfile();
      expect(p.signalSkips).toBe(1);
      expect(p.signalReads).toBe(0);
    });

    it("counts proxy reads in a find loop as skips", () => {
      const store = createStore({
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
      const store = createStore({ x: 1, y: 2 });
      // Create the signal by reading inside an effect
      effect(() => void store.x);
      resetProfiler();

      store.x = 10;
      const p = getProfile();
      expect(p.signalWrites).toBe(1);
    });

    it("counts batched mutations individually", () => {
      const store = createStore({
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
      const store = createStore({ x: 1 });
      store.x = 1; // same value
      const p = getProfile();
      expect(p.signalWrites).toBe(0);
    });
  });

  describe("effectFires", () => {
    it("counts effect fires on first select (should be 1)", () => {
      const store = createStore({
        data: [
          { id: 1, label: "a", isSelected: false },
          { id: 2, label: "b", isSelected: false },
          { id: 3, label: "c", isSelected: false },
        ],
        selected: null as number | null,
      });

      // Simulate per-row effects (like tracked Row components)
      for (let i = 0; i < store.data.length; i++) {
        effect(() => {
          void store.data[i]!.isSelected;
          void store.data[i]!.label;
        });
      }
      resetProfiler();

      // Select row 2 (no prior selection) — should fire exactly 1 effect
      startBatch();
      const item = store.data.find((d: any) => d.id === 2);
      if (item) item.isSelected = true;
      store.selected = 2;
      endBatch();

      const p = getProfile();
      expect(p.effectFires).toBe(1); // only the newly selected row
    });

    it("counts effect fires on partial update (should be N/10)", () => {
      const count = 100;
      const store = createStore({
        data: Array.from({ length: count }, (_, i) => ({
          id: i + 1,
          label: `Item ${i + 1}`,
        })),
      });

      // Simulate per-row effects
      for (let i = 0; i < count; i++) {
        effect(() => {
          void store.data[i]!.label;
        });
      }
      resetProfiler();

      // Update every 10th row
      startBatch();
      for (let i = 0; i < count; i += 10) {
        store.data[i]!.label = store.data[i]!.label + " !!!";
      }
      endBatch();

      const p = getProfile();
      expect(p.effectFires).toBe(10); // exactly 10 out of 100
    });
  });

  describe("disabled by default", () => {
    it("does not count when profiling is disabled", () => {
      disableProfiling();
      resetProfiler();
      const store = createStore({ x: 1 });
      store.x = 10;
      void store.x;
      const p = getProfile();
      expect(p.signalReads).toBe(0);
      expect(p.signalSkips).toBe(0);
      expect(p.signalWrites).toBe(0);
      expect(p.effectFires).toBe(0);
    });
  });

  describe("resetProfiler", () => {
    it("resets all counters to zero", () => {
      const store = createStore({ x: 1 });
      effect(() => void store.x);
      store.x = 2;

      const before = getProfile();
      expect(before.signalReads).toBeGreaterThan(0);

      resetProfiler();
      const after = getProfile();
      expect(after.signalReads).toBe(0);
      expect(after.signalSkips).toBe(0);
      expect(after.signalWrites).toBe(0);
      expect(after.effectFires).toBe(0);
    });
  });
});
