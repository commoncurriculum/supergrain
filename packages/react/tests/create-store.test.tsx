import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, createStore, useComputed } from "../src/index";

afterEach(() => cleanup());

interface AppState {
  items: { id: number; label: string }[];
  selected: number | null;
}

describe("createStore()", () => {
  it("returns an object with Provider and useStore", () => {
    const { Provider, useStore } = createStore<AppState>(() => ({
      items: [],
      selected: null,
    }));
    expect(typeof Provider).toBe("function");
    expect(typeof useStore).toBe("function");
  });

  it("Provider exposes the store to descendants via useStore", () => {
    const { Provider, useStore } = createStore<AppState>(() => ({
      items: [],
      selected: null,
    }));

    const Child = tracked(() => {
      const s = useStore();
      return <span data-testid="val">{String(s.selected)}</span>;
    });

    const { getByTestId } = render(
      <Provider>
        <Child />
      </Provider>,
    );

    expect(getByTestId("val").textContent).toBe("null");
  });

  it("throws when useStore is called outside Provider", () => {
    const { useStore } = createStore<AppState>(() => ({ items: [], selected: null }));

    const Bad = () => {
      useStore();
      return null;
    };

    expect(() => render(<Bad />)).toThrow();
  });

  it("store from the Provider is reactive", async () => {
    const { Provider, useStore } = createStore<AppState>(() => ({
      items: [{ id: 1, label: "hello" }],
      selected: null,
    }));

    let storeRef: AppState = null!;
    const Probe = () => {
      storeRef = useStore();
      return null;
    };
    const Child = tracked(() => {
      const s = useStore();
      return <span data-testid="label">{s.items[0].label}</span>;
    });

    const { getByTestId } = render(
      <Provider>
        <Probe />
        <Child />
      </Provider>,
    );

    expect(getByTestId("label").textContent).toBe("hello");

    await act(async () => {
      storeRef.items[0].label = "updated";
    });

    expect(getByTestId("label").textContent).toBe("updated");
  });

  it("context value is stable — store mutations don't trigger context re-renders", async () => {
    const { Provider, useStore } = createStore<AppState>(() => ({
      items: [],
      selected: null,
    }));
    let childRenders = 0;
    let storeRef: AppState = null!;

    const Probe = () => {
      storeRef = useStore();
      return null;
    };
    const Counter = () => {
      childRenders++;
      return <span>static</span>;
    };

    render(
      <Provider>
        <Probe />
        <Counter />
      </Provider>,
    );
    expect(childRenders).toBe(1);

    await act(async () => {
      storeRef.selected = 5;
    });
    expect(childRenders).toBe(1);
  });

  it("works with useComputed for the firewall pattern", async () => {
    const { Provider, useStore } = createStore<AppState>(() => ({
      items: [
        { id: 1, label: "one" },
        { id: 2, label: "two" },
        { id: 3, label: "three" },
      ],
      selected: null,
    }));
    let rowRenders = 0;
    let storeRef: AppState = null!;

    const Probe = () => {
      storeRef = useStore();
      return null;
    };
    const Row = tracked(({ id }: { id: number }) => {
      rowRenders++;
      const s = useStore();
      const isSelected = useComputed(() => s.selected === id);
      return <div data-testid={`row-${id}`}>{isSelected ? "selected" : "not"}</div>;
    });

    const { getByTestId } = render(
      <Provider>
        <Probe />
        <Row id={1} />
        <Row id={2} />
        <Row id={3} />
      </Provider>,
    );
    expect(rowRenders).toBe(3);

    // Select row 2: only row 2 re-renders
    await act(async () => {
      storeRef.selected = 2;
    });
    expect(rowRenders).toBe(4);
    expect(getByTestId("row-2").textContent).toBe("selected");

    // Switch to row 1: row 2 (true→false) and row 1 (false→true) re-render
    await act(async () => {
      storeRef.selected = 1;
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

    const Auth = createStore<AuthState>(() => ({ user: "alice" }));
    const UI = createStore<UIState>(() => ({ theme: "dark" }));

    let uiRef: UIState = null!;
    const Probe = () => {
      uiRef = UI.useStore();
      return null;
    };
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
          <Probe />
          <Display />
        </UI.Provider>
      </Auth.Provider>,
    );

    expect(getByTestId("display").textContent).toBe("alice:dark");

    await act(async () => {
      uiRef.theme = "light";
    });
    expect(getByTestId("display").textContent).toBe("alice:light");
  });

  it("each Provider mount gets an isolated store", async () => {
    const { Provider, useStore } = createStore(() => ({ count: 0 }));

    let firstRef: { count: number } = null!;
    let secondRef: { count: number } = null!;
    const First = tracked(() => {
      const s = useStore();
      firstRef = s;
      return <span data-testid="first">{s.count}</span>;
    });
    const Second = tracked(() => {
      const s = useStore();
      secondRef = s;
      return <span data-testid="second">{s.count}</span>;
    });

    const { getByTestId } = render(
      <>
        <Provider>
          <First />
        </Provider>
        <Provider>
          <Second />
        </Provider>
      </>,
    );

    expect(firstRef).not.toBe(secondRef);

    await act(async () => {
      firstRef.count = 42;
    });
    expect(getByTestId("first").textContent).toBe("42");
    expect(getByTestId("second").textContent).toBe("0");
  });

  it("infers types from the initializer — no duplicate generic needed", () => {
    const { Provider, useStore } = createStore(() => ({ count: 0, label: "test" }));

    const Child = tracked(() => {
      const s = useStore();
      // TypeScript should infer s.count as number, s.label as string
      return (
        <span>
          {s.count}
          {s.label}
        </span>
      );
    });

    const { container } = render(
      <Provider>
        <Child />
      </Provider>,
    );
    expect(container.textContent).toBe("0test");
  });
});
