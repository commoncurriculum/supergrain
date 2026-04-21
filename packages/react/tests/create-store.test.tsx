import { render, cleanup, act } from "@testing-library/react";
import React from "react";
import { describe, it, expect, afterEach } from "vitest";

import { tracked, StoreProvider, useStore, createStoreContext, useComputed } from "../src/index";

afterEach(() => cleanup());

interface AppState {
  items: { id: number; label: string }[];
  selected: number | null;
}

// =============================================================================
// Default singleton path — StoreProvider + useStore
// =============================================================================

describe("StoreProvider + useStore (default singleton)", () => {
  it("Provider exposes the store to descendants via useStore", () => {
    const Child = tracked(() => {
      const s = useStore<AppState>();
      return <span data-testid="val">{String(s.selected)}</span>;
    });

    const { getByTestId } = render(
      <StoreProvider<AppState> init={() => ({ items: [], selected: null })}>
        <Child />
      </StoreProvider>,
    );

    expect(getByTestId("val").textContent).toBe("null");
  });

  it("throws when useStore is called outside Provider", () => {
    const Bad = () => {
      useStore<AppState>();
      return null;
    };

    expect(() => render(<Bad />)).toThrow();
  });

  it("store from the Provider is reactive", async () => {
    let storeRef: AppState = null!;
    const Probe = () => {
      storeRef = useStore<AppState>();
      return null;
    };
    const Child = tracked(() => {
      const s = useStore<AppState>();
      return <span data-testid="label">{s.items[0].label}</span>;
    });

    const { getByTestId } = render(
      <StoreProvider<AppState>
        init={() => ({ items: [{ id: 1, label: "hello" }], selected: null })}
      >
        <Probe />
        <Child />
      </StoreProvider>,
    );

    expect(getByTestId("label").textContent).toBe("hello");

    await act(async () => {
      storeRef.items[0].label = "updated";
    });

    expect(getByTestId("label").textContent).toBe("updated");
  });

  it("context value is stable — store mutations don't trigger context re-renders", async () => {
    let childRenders = 0;
    let storeRef: AppState = null!;

    const Probe = () => {
      storeRef = useStore<AppState>();
      return null;
    };
    const Counter = () => {
      childRenders++;
      return <span>static</span>;
    };

    render(
      <StoreProvider<AppState> init={() => ({ items: [], selected: null })}>
        <Probe />
        <Counter />
      </StoreProvider>,
    );
    expect(childRenders).toBe(1);

    await act(async () => {
      storeRef.selected = 5;
    });
    expect(childRenders).toBe(1);
  });

  it("works with useComputed for the firewall pattern", async () => {
    let rowRenders = 0;
    let storeRef: AppState = null!;

    const Probe = () => {
      storeRef = useStore<AppState>();
      return null;
    };
    const Row = tracked(({ id }: { id: number }) => {
      rowRenders++;
      const s = useStore<AppState>();
      const isSelected = useComputed(() => s.selected === id);
      return <div data-testid={`row-${id}`}>{isSelected ? "selected" : "not"}</div>;
    });

    const { getByTestId } = render(
      <StoreProvider<AppState>
        init={() => ({
          items: [
            { id: 1, label: "one" },
            { id: 2, label: "two" },
            { id: 3, label: "three" },
          ],
          selected: null,
        })}
      >
        <Probe />
        <Row id={1} />
        <Row id={2} />
        <Row id={3} />
      </StoreProvider>,
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
});

// =============================================================================
// createStoreContext — escape hatch for isolation
// =============================================================================

describe("createStoreContext (isolation)", () => {
  it("returns an object with Provider and useStore", () => {
    const ctx = createStoreContext<AppState>();
    expect(typeof ctx.Provider).toBe("function");
    expect(typeof ctx.useStore).toBe("function");
  });

  it("supports multiple independent stores that don't collide", async () => {
    interface AuthState {
      user: string | null;
    }
    interface UIState {
      theme: string;
    }

    const Auth = createStoreContext<AuthState>();
    const UI = createStoreContext<UIState>();

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
      <Auth.Provider init={() => ({ user: "alice" })}>
        <UI.Provider init={() => ({ theme: "dark" })}>
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
    const ctx = createStoreContext<{ count: number }>();

    let firstRef: { count: number } = null!;
    let secondRef: { count: number } = null!;
    const First = tracked(() => {
      const s = ctx.useStore();
      firstRef = s;
      return <span data-testid="first">{s.count}</span>;
    });
    const Second = tracked(() => {
      const s = ctx.useStore();
      secondRef = s;
      return <span data-testid="second">{s.count}</span>;
    });

    const { getByTestId } = render(
      <>
        <ctx.Provider init={() => ({ count: 0 })}>
          <First />
        </ctx.Provider>
        <ctx.Provider init={() => ({ count: 0 })}>
          <Second />
        </ctx.Provider>
      </>,
    );

    expect(firstRef).not.toBe(secondRef);

    await act(async () => {
      firstRef.count = 42;
    });
    expect(getByTestId("first").textContent).toBe("42");
    expect(getByTestId("second").textContent).toBe("0");
  });

  it("doesn't collide with the default StoreProvider", () => {
    const ctx = createStoreContext<{ isolated: true }>();

    let defaultStore: AppState = null!;
    let isolatedStore: { isolated: true } = null!;

    const Probe = () => {
      defaultStore = useStore<AppState>();
      isolatedStore = ctx.useStore();
      return null;
    };

    render(
      <StoreProvider<AppState> init={() => ({ items: [], selected: null })}>
        <ctx.Provider init={() => ({ isolated: true })}>
          <Probe />
        </ctx.Provider>
      </StoreProvider>,
    );

    expect(defaultStore.items).toEqual([]);
    expect(isolatedStore.isolated).toBe(true);
  });
});
