import { createReactive } from "@supergrain/kernel";
import { tracked, type TrackedRefProps } from "@supergrain/kernel/react";
import { render, cleanup, act } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Item {
  label: string;
}

/** Wait past the disposal queue's rAF→setTimeout flush (and its 100ms backstop). */
function flushDisposalQueue(): Promise<void> {
  return act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 150);
      }),
  );
}

describe("tracked() with refDisposal", () => {
  it("stays reactive with the trackedRef attached (updates re-render)", async () => {
    const store = createReactive<{ item: Item }>({ item: { label: "a" } });
    let renders = 0;

    const Row = tracked(
      ({ trackedRef }: TrackedRefProps) => {
        renders++;
        return <div ref={trackedRef}>{store.item.label}</div>;
      },
      { refDisposal: true },
    );

    const { container } = render(<Row />);
    expect(container.textContent).toBe("a");
    const before = renders;

    await act(async () => {
      store.item.label = "b";
    });
    expect(container.textContent).toBe("b");
    expect(renders).toBeGreaterThan(before);
  });

  it("disposes via the ref cleanup on unmount — later writes don't fire the effect", async () => {
    const store = createReactive<{ item: Item }>({ item: { label: "a" } });
    let renders = 0;

    const Row = tracked(
      ({ trackedRef }: TrackedRefProps) => {
        renders++;
        return <div ref={trackedRef}>{store.item.label}</div>;
      },
      { refDisposal: true },
    );

    const { unmount } = render(<Row />);
    unmount();
    await flushDisposalQueue();

    const after = renders;
    await act(async () => {
      store.item.label = "c";
    });
    // The effect was unlinked from the signal graph; the write must not
    // attempt a re-render of the unmounted component.
    expect(renders).toBe(after);
  });

  it("survives StrictMode's attach → cleanup → re-attach cycle", async () => {
    const store = createReactive<{ item: Item }>({ item: { label: "a" } });

    const Row = tracked(
      ({ trackedRef }: TrackedRefProps) => <div ref={trackedRef}>{store.item.label}</div>,
      { refDisposal: true },
    );

    const { container } = render(
      <StrictMode>
        <Row />
      </StrictMode>,
    );
    // Let the deferred (and cancelled) disposal from the strict-mode cycle
    // flush before asserting the effect is still alive.
    await flushDisposalQueue();

    await act(async () => {
      store.item.label = "strict";
    });
    expect(container.textContent).toBe("strict");
  });

  it("dev leak guard: warns and disposes when trackedRef is never attached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createReactive<{ item: Item }>({ item: { label: "a" } });

    // Opts in but never attaches the ref — the dev-only backstop must warn.
    const Row = tracked(() => <div>{store.item.label}</div>, { refDisposal: true });

    const { unmount } = render(<Row />);
    unmount();
    await flushDisposalQueue();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("trackedRef"));
  });

  it("without refDisposal, no trackedRef prop is injected", () => {
    let seenTrackedRef: unknown = "sentinel";

    const Plain = tracked((props: TrackedRefProps) => {
      seenTrackedRef = props.trackedRef;
      return <div />;
    });

    render(<Plain />);
    expect(seenTrackedRef).toBeUndefined();
  });
});
