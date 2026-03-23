/* eslint-disable unicorn/filename-case */
import { createStore, effect } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React, { memo, useState, useEffect } from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("tracked() Mechanism Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("tracked() enables reactive subscriptions, memo() alone does not", async () => {
    const [store, update] = createStore({
      items: [{ deep: { value: 1 } }],
    });

    let trackedRenderCount = 0;
    let nonTrackedRenderCount = 0;

    const TrackedComponent = tracked(() => {
      trackedRenderCount++;
      const value = store.items[0].deep.value;
      return <div data-testid="tracked-value">{value}</div>;
    });

    const NonTrackedComponent = memo(() => {
      nonTrackedRenderCount++;
      const value = store.items[0].deep.value;
      return <div data-testid="non-tracked-value">{value}</div>;
    });

    const { container } = render(
      <div>
        <TrackedComponent />
        <NonTrackedComponent />
      </div>,
    );

    expect(container.querySelector('[data-testid="tracked-value"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-testid="non-tracked-value"]')?.textContent).toBe("1");

    await act(async () => {
      update({ $set: { "items.0.deep.value": 42 } });
      await flushMicrotasks();
    });

    // tracked() component re-renders on store change
    expect(trackedRenderCount).toBe(2);
    expect(container.querySelector('[data-testid="tracked-value"]')?.textContent).toBe("42");

    // memo() component does NOT re-render — no reactive subscription
    expect(nonTrackedRenderCount).toBe(1);
    expect(container.querySelector('[data-testid="non-tracked-value"]')?.textContent).toBe("1");
  });

  it("manual effect() wires subscriptions like tracked() does internally", async () => {
    const [store, update] = createStore({
      items: [{ deep: { value: 100 } }],
    });

    let effectTriggered = false;
    let manualRenderCount = 0;

    const ManualEffectComponent = memo(() => {
      manualRenderCount++;
      const [, forceUpdate] = useState({});

      useEffect(() => {
        const cleanup = effect(() => {
          store.items[0].deep.value;
          if (effectTriggered) {
            forceUpdate({});
          }
          effectTriggered = true;
        });
        return cleanup;
      }, []);

      const value = store.items[0].deep.value;
      return <div data-testid="manual-effect-value">{value}</div>;
    });

    render(<ManualEffectComponent />);
    expect(manualRenderCount).toBe(1);

    await act(async () => {
      update({ $set: { "items.0.deep.value": 200 } });
      await flushMicrotasks();
    });

    // The effect fires on change and triggers forceUpdate
    expect(effectTriggered).toBe(true);
    expect(manualRenderCount).toBe(2);
  });

  it("only accessed properties trigger re-renders, unaccessed do not", async () => {
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
      const value = store.items[0].accessed.value;
      return <div data-testid="specific-value">{value}</div>;
    });

    render(<SpecificSubscriptionComponent />);
    expect(renderCount).toBe(1);

    // Update the accessed property — should re-render
    await act(async () => {
      update({ $set: { "items.0.accessed.value": 42 } });
      await flushMicrotasks();
    });

    expect(renderCount).toBe(2);

    // Update the NOT-accessed property — should NOT re-render
    await act(async () => {
      update({ $set: { "items.0.notAccessed.value": 777 } });
      await flushMicrotasks();
    });

    expect(renderCount).toBe(2);
  });
});
