import { signal, createReactive } from "@supergrain/kernel";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, it, expect, afterEach } from "vitest";

afterEach(() => cleanup());

describe("tracked() under StrictMode", () => {
  it("re-renders on signal change after StrictMode mount cycle", async () => {
    const count = signal(0);
    const Component = tracked(() => <span data-testid="v">{count()}</span>);

    const { getByTestId } = render(
      <StrictMode>
        <Component />
      </StrictMode>,
    );

    expect(getByTestId("v").textContent).toBe("0");
    await act(async () => {
      count(1);
    });
    expect(getByTestId("v").textContent).toBe("1");
  });

  it("re-renders on reactive object property change after StrictMode mount cycle", async () => {
    const state = createReactive<{ status: string }>({ status: "loading" });
    const Component = tracked(() => <span>{state.status}</span>);

    render(
      <StrictMode>
        <Component />
      </StrictMode>,
    );
    expect(screen.getByText("loading")).toBeDefined();

    await act(async () => {
      state.status = "ready";
    });

    expect(screen.getByText("ready")).toBeDefined();
  });
});
