import { update } from "@supergrain/mill";
import { effect, getCurrentSub, setCurrentSub } from "alien-signals";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createGrain,
  enableProfiling,
  disableProfiling,
  resetProfiler,
  getProfile,
} from "../../src";

describe("Tracking Isolation Analysis", () => {
  beforeEach(() => {
    enableProfiling();
    resetProfiler();
  });

  afterEach(() => {
    disableProfiling();
  });

  it("demonstrates perfect isolation with per-render pattern (tracked style)", () => {
    const store = createGrain({ parent: 1, child: 10 });

    let parentEffectRuns = 0;
    let childEffectRuns = 0;

    // Simulate tracked() pattern - subscriber set for entire render
    function simulateTrackedPattern(componentName: string) {
      let effectNode: any = null;
      let isFirstRun = true;

      // Create component's effect
      const cleanup = effect(() => {
        if (isFirstRun) {
          effectNode = getCurrentSub();
          isFirstRun = false;
          if (componentName === "parent") parentEffectRuns++;
          if (componentName === "child") childEffectRuns++;
          return;
        }

        if (componentName === "parent") parentEffectRuns++;
        if (componentName === "child") childEffectRuns++;
      });

      // Set effect as current subscriber and access property
      const prevSub = getCurrentSub();
      setCurrentSub(effectNode);
      // Access the property (this establishes tracking)
      if (componentName === "parent") {
        void store.parent;
      } else {
        void store.child;
      }
      setCurrentSub(prevSub);

      return { cleanup, effectNode };
    }

    const parent = simulateTrackedPattern("parent");
    const child = simulateTrackedPattern("child");

    expect(parentEffectRuns).toBe(1);
    expect(childEffectRuns).toBe(1);

    resetProfiler();

    // Update parent property
    update(store, { $set: { parent: 2 } });

    expect(parentEffectRuns).toBe(2); // Parent should re-run
    expect(childEffectRuns).toBe(1); // Child should NOT re-run

    const p1 = getProfile();
    expect(p1.signalWrites).toBe(1); // only parent
    resetProfiler();

    // Update child property
    update(store, { $set: { child: 20 } });

    expect(parentEffectRuns).toBe(2); // Parent should NOT re-run
    expect(childEffectRuns).toBe(2); // Child should re-run

    const p2 = getProfile();
    expect(p2.signalWrites).toBe(1); // only child

    parent.cleanup();
    child.cleanup();
  });
});
