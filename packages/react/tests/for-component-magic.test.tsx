import { createStore } from "@supergrain/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { tracked, For } from "../src";
import { flushMicrotasks } from "./test-utils";

describe("For Component Magic Tests", () => {
  beforeEach(() => {
    cleanup();
  });

  it("For and map both re-render when an iterated element property changes", async () => {
    const [store, update] = createStore({
      data: [
        { id: 1, label: "Item 1" },
        { id: 2, label: "Item 2" },
      ],
    });

    let withForRenderCount = 0;
    let withMapRenderCount = 0;

    const WithForComponent = tracked(() => {
      withForRenderCount++;
      return (
        <div>
          <For each={store.data}>{(item: any) => <div key={item.id}>{item.label}</div>}</For>
        </div>
      );
    });

    const WithMapComponent = tracked(() => {
      withMapRenderCount++;
      return (
        <div>
          {store.data.map((item: any) => (
            <div key={item.id}>{item.label}</div>
          ))}
        </div>
      );
    });

    render(
      <div>
        <WithForComponent />
        <WithMapComponent />
      </div>,
    );

    expect(withForRenderCount).toBe(1);
    expect(withMapRenderCount).toBe(1);

    await act(async () => {
      update({ $set: { "data.0.label": "Updated Item 1" } });
      await flushMicrotasks();
    });

    // map component re-renders because it iterates and reads item.label in its own scope
    expect(withMapRenderCount).toBe(2);
    // For component does NOT re-render — For handles iteration internally,
    // so the parent component's tracked scope doesn't subscribe to element properties
    expect(withForRenderCount).toBe(1);
  });

  it("push on empty array triggers For re-render (fresh store)", async () => {
    const [store] = createStore<{ data: { id: number; label: string }[] }>({ data: [] });

    const App = tracked(() => (
      <ul>
        <For each={store.data}>
          {(item: { id: number; label: string }) => <li key={item.id}>{item.label}</li>}
        </For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(0);

    await act(async () => {
      store.data.push({ id: 1, label: "first" }, { id: 2, label: "second" });
    });

    expect(container.querySelectorAll("li").length).toBe(2);
    expect(container.querySelectorAll("li")[0].textContent).toBe("first");
  });

  it("splice on array triggers For re-render (fresh store, no prior assignment)", async () => {
    const [store] = createStore<{ items: string[] }>({ items: ["a", "b", "c"] });

    const App = tracked(() => (
      <ul>
        <For each={store.items}>{(item: string, i: number) => <li key={i}>{item}</li>}</For>
      </ul>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("li").length).toBe(3);

    await act(async () => {
      store.items.splice(1, 1); // remove "b"
    });

    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("a");
    expect(items[1].textContent).toBe("c");
  });

  it("push after initial empty render without any prior store.data assignment", async () => {
    // This is the exact scenario that broke the production benchmark:
    // 1. Fresh store with empty array
    // 2. Component renders (empty)
    // 3. First mutation is push (not assignment)
    const [store] = createStore<{ data: { id: number }[] }>({ data: [] });

    const App = tracked(() => (
      <For each={store.data}>{(item: { id: number }) => <span key={item.id}>{item.id}</span>}</For>
    ));

    const { container } = render(<App />);
    expect(container.querySelectorAll("span").length).toBe(0);

    // First mutation is push — no prior store.data = [...] assignment
    await act(async () => {
      store.data.push({ id: 1 });
    });

    expect(container.querySelectorAll("span").length).toBe(1);
    expect(container.querySelector("span")!.textContent).toBe("1");
  });
});
