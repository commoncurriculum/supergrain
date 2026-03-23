import { createStore } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("Parent Invalidation Depth Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("only the component reading the changed leaf re-renders, not parent accessors", async () => {
    const [store, update] = createStore({
      level0: {
        level1: {
          level2: {
            value: "initial",
          },
        },
      },
    });

    let shallowRenders = 0;
    let deepRenders = 0;

    // Reads store.level0 (shallow)
    const ShallowComponent = tracked(() => {
      shallowRenders++;
      const _ = store.level0;
      return <div>shallow</div>;
    });

    // Reads the actual leaf value
    const DeepComponent = tracked(() => {
      deepRenders++;
      return <div>{store.level0.level1.level2.value}</div>;
    });

    render(
      <div>
        <ShallowComponent />
        <DeepComponent />
      </div>,
    );

    expect(shallowRenders).toBe(1);
    expect(deepRenders).toBe(1);

    await act(async () => {
      update({ $set: { "level0.level1.level2.value": "updated" } });
      await flushMicrotasks();
    });

    // Deep component re-renders because it reads the changed value
    expect(deepRenders).toBe(2);
    // Shallow component should NOT re-render — it only accesses level0, not the leaf
    expect(shallowRenders).toBe(1);
  });

  it("replacing an intermediate object re-renders components that access it", async () => {
    const [store, update] = createStore({
      level0: {
        level1: {
          value: "initial",
        },
      },
    });

    let level0Renders = 0;
    let level1Renders = 0;

    const Level0Component = tracked(() => {
      level0Renders++;
      const _ = store.level0;
      return <div>level0</div>;
    });

    const Level1Component = tracked(() => {
      level1Renders++;
      return <div>{store.level0.level1.value}</div>;
    });

    render(
      <div>
        <Level0Component />
        <Level1Component />
      </div>,
    );

    expect(level0Renders).toBe(1);
    expect(level1Renders).toBe(1);

    // Replace the entire level1 object
    await act(async () => {
      update({ $set: { "level0.level1": { value: "replaced" } } });
      await flushMicrotasks();
    });

    // Level1Component reads through level1 — should re-render
    expect(level1Renders).toBe(2);
  });

  it("updating a nested array item property only re-renders the subscribed component", async () => {
    const [store, update] = createStore({
      items: [
        { id: 1, name: "Item 1", meta: { tag: "A" } },
        { id: 2, name: "Item 2", meta: { tag: "B" } },
      ],
    });

    let arrayRenders = 0;
    let tagRenders = 0;

    // Reads the array (length/iteration)
    const ArrayComponent = tracked(() => {
      arrayRenders++;
      const _ = store.items.length;
      return <div>count: {store.items.length}</div>;
    });

    // Reads a specific nested property
    const TagComponent = tracked(() => {
      tagRenders++;
      return <div>{store.items[0].meta.tag}</div>;
    });

    render(
      <div>
        <ArrayComponent />
        <TagComponent />
      </div>,
    );

    expect(arrayRenders).toBe(1);
    expect(tagRenders).toBe(1);

    await act(async () => {
      update({ $set: { "items.0.meta.tag": "UPDATED" } });
      await flushMicrotasks();
    });

    // TagComponent re-renders because it reads items[0].meta.tag
    expect(tagRenders).toBe(2);
    // ArrayComponent should NOT re-render — it only reads length
    expect(arrayRenders).toBe(1);
  });
});
