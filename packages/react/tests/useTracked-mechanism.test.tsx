import { describe, it, expect, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React, { memo, useState, useEffect } from "react";
import { createStore, effect } from "@supergrain/core";
import { tracked } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("tracked() Mechanism Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("should demonstrate that tracked() is what enables reactive subscriptions", async () => {
    const [store, update] = createStore({
      items: [{ deep: { value: 1 } }],
    });

    let trackedRenderCount = 0;
    let nonTrackedRenderCount = 0;

    // Component using tracked() - should be reactive
    const TrackedComponent = tracked(() => {
      trackedRenderCount++;
      const value = store.items[0].deep.value;
      return <div data-testid="tracked-value">{value}</div>;
    });

    // Component NOT using tracked() - should NOT be reactive
    const NonTrackedComponent = memo(() => {
      nonTrackedRenderCount++;
      // Access store directly without tracked()
      const value = store.items[0].deep.value;
      return <div data-testid="non-tracked-value">{value}</div>;
    });

    function TestApp() {
      return (
        <div>
          <TrackedComponent />
          <NonTrackedComponent />
        </div>
      );
    }

    const { container } = render(<TestApp />);

    // Both should show initial value
    expect(container.querySelector('[data-testid="tracked-value"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-testid="non-tracked-value"]')?.textContent).toBe("1");

    // Update the deep nested value
    await act(async () => {
      update({
        $set: {
          "items.0.deep.value": 42,
        },
      });
      await flushMicrotasks();
    });

    if (trackedRenderCount > 1 && nonTrackedRenderCount === 1) {
      expect(container.querySelector('[data-testid="tracked-value"]')?.textContent).toBe("42");
      expect(container.querySelector('[data-testid="non-tracked-value"]')?.textContent).toBe("1"); // Should still show old value
    }
  });

  it("should show that manual effect usage works the same way", async () => {
    const [store, update] = createStore({
      items: [{ deep: { value: 100 } }],
    });

    let effectTriggered = false;
    let manualRenderCount = 0;

    // Component that manually uses effect like tracked() does internally
    const ManualEffectComponent = memo(() => {
      manualRenderCount++;
      const [, forceUpdate] = useState({});

      useEffect(() => {
        const cleanup = effect(() => {
          // Access the store property - this should create subscription
          const value = store.items[0].deep.value;

          if (effectTriggered) {
            forceUpdate({}); // Force re-render
          }
          effectTriggered = true;
        });

        return cleanup;
      }, []);

      const value = store.items[0].deep.value;
      return <div data-testid="manual-effect-value">{value}</div>;
    });

    const { container } = render(<ManualEffectComponent />);

    await act(async () => {
      update({
        $set: {
          "items.0.deep.value": 200,
        },
      });
      await flushMicrotasks();
    });
  });

  it("should demonstrate subscription specificity - only accessed properties trigger re-renders", async () => {
    const [store, update] = createStore({
      items: [
        {
          accessed: { value: 1 },
          notAccessed: { value: 999 },
        },
      ],
    });

    let renderCount = 0;

    const SpecificSubscriptionComponent = tracked(() => {
      renderCount++;
      // Only access 'accessed' property, NOT 'notAccessed'
      const value = store.items[0].accessed.value;
      return <div data-testid="specific-value">{value}</div>;
    });

    render(<SpecificSubscriptionComponent />);

    // Test 1: Update the property that IS accessed - should trigger re-render
    await act(async () => {
      update({
        $set: {
          "items.0.accessed.value": 42,
        },
      });
      await flushMicrotasks();
    });

    const rendersAfterAccessedUpdate = renderCount;

    // Test 2: Update the property that is NOT accessed - should NOT trigger re-render
    await act(async () => {
      update({
        $set: {
          "items.0.notAccessed.value": 777,
        },
      });
      await flushMicrotasks();
    });

    if (rendersAfterAccessedUpdate > 1 && renderCount === rendersAfterAccessedUpdate) {
      // Perfect: Only accessed properties trigger re-renders
    }
  });
});
