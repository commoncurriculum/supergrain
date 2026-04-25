import { tracked, useGrain } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

afterEach(() => cleanup());

describe("useGrain()", () => {
  it("returns a reactive proxy over the initial object", () => {
    let proxyRef: { count: number } = null!;
    const Component = tracked(() => {
      const state = useGrain({ count: 0 });
      proxyRef = state;
      return <span data-testid="count">{state.count}</span>;
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("count").textContent).toBe("0");
    expect(proxyRef).toBeDefined();
  });

  it("proxy identity is stable across renders", async () => {
    const refs: Array<{ count: number }> = [];
    const Component = tracked(() => {
      const state = useGrain({ count: 0 });
      refs.push(state);
      return (
        <button data-testid="btn" onClick={() => (state.count += 1)}>
          {state.count}
        </button>
      );
    });

    const { getByTestId } = render(<Component />);
    expect(refs.length).toBe(1);

    await act(async () => {
      getByTestId("btn").click();
    });

    expect(getByTestId("btn").textContent).toBe("1");
    // Every reference from every render must point to the same proxy
    for (const r of refs) {
      expect(r).toBe(refs[0]);
    }
  });

  it("mutations trigger re-renders within the component", async () => {
    const Component = tracked(() => {
      const state = useGrain({ count: 0 });
      return (
        <button data-testid="btn" onClick={() => (state.count += 1)}>
          {state.count}
        </button>
      );
    });

    const { getByTestId } = render(<Component />);
    expect(getByTestId("btn").textContent).toBe("0");

    await act(async () => {
      getByTestId("btn").click();
    });
    expect(getByTestId("btn").textContent).toBe("1");

    await act(async () => {
      getByTestId("btn").click();
    });
    expect(getByTestId("btn").textContent).toBe("2");
  });

  it("each mount gets an independent store", async () => {
    const refs: Array<{ count: number }> = [];
    const Component = tracked(() => {
      const state = useGrain({ count: 0 });
      refs.push(state);
      return <span>{state.count}</span>;
    });

    render(
      <>
        <Component />
        <Component />
      </>,
    );

    expect(refs.length).toBe(2);
    expect(refs[0]).not.toBe(refs[1]);
  });
});
