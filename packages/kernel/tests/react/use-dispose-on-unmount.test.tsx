import { useDisposeOnUnmount } from "@supergrain/kernel/react";
import { render, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => cleanup());

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("useDisposeOnUnmount", () => {
  it("runs the cleanup once, on the real unmount, under StrictMode", async () => {
    const dispose = vi.fn();
    const Probe = () => {
      useDisposeOnUnmount(dispose);
      return null;
    };

    const { unmount } = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await sleep(10);
    expect(dispose).not.toHaveBeenCalled();

    unmount();
    await sleep(10);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("calls the cleanup from the latest render", async () => {
    const calls: Array<string> = [];
    const Probe = ({ name }: { name: string }) => {
      useDisposeOnUnmount(() => calls.push(name));
      return null;
    };

    const { rerender, unmount } = render(<Probe name="first" />);
    rerender(<Probe name="second" />);
    unmount();
    await sleep(10);
    expect(calls).toEqual(["second"]);
  });
});
