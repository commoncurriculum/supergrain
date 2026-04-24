import type { ReactiveTask } from "@supergrain/husk";

import { useReactiveTask } from "@supergrain/husk/react";
import { tracked } from "@supergrain/kernel/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useReactiveTask()", () => {
  it("creates a stable task and runs it successfully", async () => {
    const Component = tracked(() => {
      const task = useReactiveTask(async (n: number) => n * 2);
      return (
        <div>
          <span data-testid="pending">{String(task.isPending)}</span>
          <span data-testid="data">{task.isReady ? String(task.data) : "none"}</span>
          <button data-testid="run" onClick={() => task.run(5)} />
        </div>
      );
    });

    render(<Component />);
    expect(screen.getByTestId("pending").textContent).toBe("false");
    expect(screen.getByTestId("data").textContent).toBe("none");

    await act(async () => {
      screen.getByTestId("run").click();
      await Promise.resolve();
    });

    expect(screen.getByTestId("data").textContent).toBe("10");
    expect(screen.getByTestId("pending").textContent).toBe("false");
  });

  it("keeps a stable task identity while refreshing the async closure", async () => {
    let task: ReactiveTask<[number], number> | null = null;

    const Component = tracked(({ multiplier }: { multiplier: number }) => {
      task = useReactiveTask(async (value: number) => value * multiplier);
      return <span data-testid="value">{task.isReady ? task.data : "idle"}</span>;
    });

    const { getByTestId, rerender } = render(<Component multiplier={2} />);
    const firstTask = task!;

    await act(async () => {
      await firstTask.run(3);
    });
    expect(getByTestId("value").textContent).toBe("6");

    rerender(<Component multiplier={4} />);
    expect(task).toBe(firstTask);

    await act(async () => {
      await firstTask.run(3);
    });
    expect(getByTestId("value").textContent).toBe("12");
  });

  it("keeps the same task identity across re-renders", () => {
    let taskRef: object | undefined;

    const Component = tracked(({ tick }: { tick: number }) => {
      void tick;
      const task = useReactiveTask(async () => 1);
      if (!taskRef) {
        taskRef = task;
      } else {
        expect(task).toBe(taskRef);
      }
      return <div />;
    });

    const { rerender } = render(<Component tick={0} />);
    rerender(<Component tick={1} />);
  });

  it("disposes on unmount and ignores late task resolutions", async () => {
    const d = deferred<number>();
    let task: ReactiveTask<[number], number> | null = null;

    const Component = tracked(() => {
      task = useReactiveTask(async (value: number) => value * (await d.promise));
      return (
        <span data-testid="value">
          {task.isPending ? "pending" : task.isReady ? task.data : "idle"}
        </span>
      );
    });

    const { getByTestId, unmount } = render(<Component />);
    const mountedTask = task!;

    let pending!: Promise<number>;
    await act(async () => {
      pending = mountedTask.run(3);
    });
    expect(getByTestId("value").textContent).toBe("pending");

    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mountedTask.isPending).toBe(false);

    await act(async () => {
      d.resolve(7);
      await pending;
    });

    expect(mountedTask.data).toBe(null);
    expect(mountedTask.error).toBe(null);
    expect(mountedTask.isReady).toBe(false);
    expect(mountedTask.isResolved).toBe(false);
    expect(mountedTask.isRejected).toBe(false);
  });

  it("survives StrictMode dev re-mount with a working post-mount task", async () => {
    let task: ReactiveTask<[number], number> | null = null;

    const Component = tracked(() => {
      task = useReactiveTask(async (value: number) => value * 2);
      return <span data-testid="value">{task.isReady ? task.data : "idle"}</span>;
    });

    const { getByTestId } = render(
      <StrictMode>
        <Component />
      </StrictMode>,
    );

    const liveTask = task!;
    await act(async () => {
      await liveTask.run(5);
    });
    expect(getByTestId("value").textContent).toBe("10");
  });
});
