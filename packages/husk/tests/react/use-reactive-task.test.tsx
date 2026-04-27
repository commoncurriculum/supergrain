import { useReactiveTask } from "@supergrain/husk/react";
import { tracked } from "@supergrain/kernel/react";
import { render, cleanup, act, screen } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

afterEach(() => cleanup());

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

  it("keeps the same task identity across re-renders", () => {
    // useReactiveTask uses useMemo([], ...) — same instance every render.
    // We verify this by calling the hook twice in sequence (mount + re-render
    // triggered by a state change) and checking the returned object is ===.
    let taskRef: object | undefined;

    const Component = tracked(({ tick }: { tick: number }) => {
      // Suppress lint about unused tick — it forces a re-render.
      void tick;
      const task = useReactiveTask(async () => 1);
      if (!taskRef) {
        taskRef = task;
      } else {
        // This assertion runs on the second render.
        expect(task).toBe(taskRef);
      }
      return <div />;
    });

    const { rerender } = render(<Component tick={0} />);
    rerender(<Component tick={1} />);
  });
});
