import { tracked, createStoreContext, useComputed } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

afterEach(() => cleanup());

interface AppState {
  items: { id: number; label: string }[];
  selected: number | null;
}

describe("createStoreContext", () => {
  it("returns an object with Provider and useStore", () => {
    const ctx = createStoreContext<AppState>();
    expect(typeof ctx.Provider).toBe("function");
    expect(typeof ctx.useStore).toBe("function");
  });

  it("Provider exposes a reactive store to descendants via useStore", () => {
    const { Provider, useStore } = createStoreContext<AppState>();

    const Child = tracked(() => {
      const s = useStore();
      return <span data-testid="val">{String(s.selected)}</span>;
    });

    const { getByTestId } = render(
      <Provider initial={{ items: [], selected: null }}>
        <Child />
      </Provider>,
    );

    expect(getByTestId("val").textContent).toBe("null");
  });

  it("throws when useStore is called outside Provider", () => {
    const { useStore } = createStoreContext<AppState>();
    const Bad = () => {
      useStore();
      return null;
    };

    expect(() => render(<Bad />)).toThrow();
  });

  it("store from the Provider is reactive", async () => {
    const { Provider, useStore } = createStoreContext<AppState>();

    let storeRef: AppState = null!;
    const Probe = () => {
      storeRef = useStore();
      return null;
    };
    const Child = tracked(() => {
      const s = useStore();
      return <span data-testid="label">{s.items[0]!.label}</span>;
    });

    const { getByTestId } = render(
      <Provider initial={{ items: [{ id: 1, label: "hello" }], selected: null }}>
        <Probe />
        <Child />
      </Provider>,
    );

    expect(getByTestId("label").textContent).toBe("hello");

    await act(async () => {
      storeRef.items[0]!.label = "updated";
    });

    expect(getByTestId("label").textContent).toBe("updated");
  });

  it("context value is stable — store mutations don't trigger context re-renders", async () => {
    const { Provider, useStore } = createStoreContext<AppState>();

    let storeRef: AppState = null!;
    let childRenders = 0;

    const Probe = () => {
      storeRef = useStore();
      return null;
    };
    const Counter = () => {
      childRenders++;
      return <span>static</span>;
    };

    render(
      <Provider initial={{ items: [], selected: null }}>
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
    const { Provider, useStore } = createStoreContext<AppState>();

    let storeRef: AppState = null!;
    let rowRenders = 0;

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
      <Provider
        initial={{
          items: [
            { id: 1, label: "one" },
            { id: 2, label: "two" },
            { id: 3, label: "three" },
          ],
          selected: null,
        }}
      >
        <Probe />
        <Row id={1} />
        <Row id={2} />
        <Row id={3} />
      </Provider>,
    );
    expect(rowRenders).toBe(3);

    await act(async () => {
      storeRef.selected = 2;
    });
    expect(rowRenders).toBe(4);
    expect(getByTestId("row-2").textContent).toBe("selected");

    await act(async () => {
      storeRef.selected = 1;
    });
    expect(rowRenders).toBe(6);
    expect(getByTestId("row-1").textContent).toBe("selected");
    expect(getByTestId("row-2").textContent).toBe("not");
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
      <Auth.Provider initial={{ user: "alice" }}>
        <UI.Provider initial={{ theme: "dark" }}>
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
        <ctx.Provider initial={{ count: 0 }}>
          <First />
        </ctx.Provider>
        <ctx.Provider initial={{ count: 0 }}>
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
});
