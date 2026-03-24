import { createStore } from "@supergrain/core";
import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, provideStore, useComputed } from "../src/index";

afterEach(() => cleanup());

interface AppState {
  items: { id: number; label: string }[];
  selected: number | null;
}

describe("provideStore()", () => {
  it("returns an object with Provider and useStore", () => {
    const store = createStore<AppState>({ items: [], selected: null });
    const Store = provideStore(store);
    expect(typeof Store.Provider).toBe("function");
    expect(typeof Store.useStore).toBe("function");
  });

  it("Provider requires no props (store is pre-bound)", () => {
    const store = createStore<AppState>({ items: [], selected: null });
    const Store = provideStore(store);

    const Child = tracked(() => {
      const s = Store.useStore();
      return <span data-testid="val">{String(s.selected)}</span>;
    });

    const { getByTestId } = render(
      <Store.Provider>
        <Child />
      </Store.Provider>,
    );

    expect(getByTestId("val").textContent).toBe("null");
  });

  it("throws when useStore is called outside Provider", () => {
    const store = createStore<AppState>({ items: [], selected: null });
    const Store = provideStore(store);

    const Bad = () => {
      Store.useStore();
      return null;
    };

    expect(() => render(<Bad />)).toThrow();
  });

  it("injected store is reactive", async () => {
    const store = createStore<AppState>({
      items: [{ id: 1, label: "hello" }],
      selected: null,
    });
    const Store = provideStore(store);

    const Child = tracked(() => {
      const s = Store.useStore();
      return <span data-testid="label">{s.items[0].label}</span>;
    });

    const { getByTestId } = render(
      <Store.Provider>
        <Child />
      </Store.Provider>,
    );

    expect(getByTestId("label").textContent).toBe("hello");

    await act(async () => {
      store.items[0].label = "updated";
    });

    expect(getByTestId("label").textContent).toBe("updated");
  });

  it("context value is stable — store mutations don't trigger context re-renders", async () => {
    const store = createStore<AppState>({ items: [], selected: null });
    const Store = provideStore(store);
    let childRenders = 0;

    const Counter = () => {
      childRenders++;
      return <span>static</span>;
    };

    render(
      <Store.Provider>
        <Counter />
      </Store.Provider>,
    );
    expect(childRenders).toBe(1);

    await act(async () => {
      store.selected = 5;
    });
    expect(childRenders).toBe(1);
  });

  it("works with useComputed for the firewall pattern", async () => {
    const store = createStore<AppState>({
      items: [
        { id: 1, label: "one" },
        { id: 2, label: "two" },
        { id: 3, label: "three" },
      ],
      selected: null,
    });
    const Store = provideStore(store);
    let rowRenders = 0;

    const Row = tracked(({ id }: { id: number }) => {
      rowRenders++;
      const s = Store.useStore();
      const isSelected = useComputed(() => s.selected === id);
      return <div data-testid={`row-${id}`}>{isSelected ? "selected" : "not"}</div>;
    });

    const { getByTestId } = render(
      <Store.Provider>
        <Row id={1} />
        <Row id={2} />
        <Row id={3} />
      </Store.Provider>,
    );
    expect(rowRenders).toBe(3);

    // Select row 2: only row 2 re-renders
    await act(async () => {
      store.selected = 2;
    });
    expect(rowRenders).toBe(4);
    expect(getByTestId("row-2").textContent).toBe("selected");

    // Switch to row 1: row 2 (true→false) and row 1 (false→true) re-render
    await act(async () => {
      store.selected = 1;
    });
    expect(rowRenders).toBe(6);
    expect(getByTestId("row-1").textContent).toBe("selected");
    expect(getByTestId("row-2").textContent).toBe("not");
  });

  it("supports multiple independent stores", async () => {
    interface AuthState {
      user: string | null;
    }
    interface UIState {
      theme: string;
    }

    const authStore = createStore<AuthState>({ user: "alice" });
    const uiStore = createStore<UIState>({ theme: "dark" });

    const Auth = provideStore(authStore);
    const UI = provideStore(uiStore);

    const Display = tracked(() => {
      const auth = Auth.useStore();
      const ui = UI.useStore();
      return (
        <span data-testid="display">
          {auth.user}:{ui.theme}
        </span>
      );
    });

    const { getByTestId } = render(
      <Auth.Provider>
        <UI.Provider>
          <Display />
        </UI.Provider>
      </Auth.Provider>,
    );

    expect(getByTestId("display").textContent).toBe("alice:dark");

    await act(async () => {
      uiStore.theme = "light";
    });
    expect(getByTestId("display").textContent).toBe("alice:light");
  });

  it("infers types from the store — no duplicate generic needed", () => {
    const store = createStore({ count: 0, label: "test" });
    const Store = provideStore(store);

    const Child = tracked(() => {
      const s = Store.useStore();
      // TypeScript should infer s.count as number, s.label as string
      return (
        <span>
          {s.count}
          {s.label}
        </span>
      );
    });

    const { container } = render(
      <Store.Provider>
        <Child />
      </Store.Provider>,
    );
    expect(container.textContent).toBe("0test");
  });
});
