import { collectBrowserSamples, expectBrowserTrend } from "@supergrain/test-utils/browser-memory";
import { cleanup, render, act, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, it } from "vitest";

import { tracked, useReactive } from "../../src/react";

afterEach(() => cleanup());

interface BrowserLeaf {
  label: string;
  values: Array<number>;
}

function makePayload(seed: number, width = 20): Array<BrowserLeaf> {
  return Array.from({ length: width }, (_, index) => ({
    label: `leaf-${seed}-${index}`,
    values: Array.from({ length: 16 }, (__, offset) => seed + index + offset),
  }));
}

const KernelHarness = tracked(function KernelHarness({ seed }: { seed: number }) {
  const state = useReactive({
    cursor: 0,
    leaves: makePayload(seed),
  });

  return (
    <button
      data-testid="kernel-memory"
      type="button"
      onClick={() => {
        state.cursor = (state.cursor + 1) % state.leaves.length;
        state.leaves[0]!.label = `updated-${seed}-${state.cursor}`;
      }}
    >
      {state.leaves[state.cursor]!.values[0]}
    </button>
  );
});

describe("kernel react memory", () => {
  it("keeps Chromium heap flat across repeated mount and unmount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 10; index++) {
        const view = render(<KernelHarness seed={round * 100 + index} />);
        await act(async () => {
          view.getByTestId("kernel-memory").click();
          view.getByTestId("kernel-memory").click();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 3_000_000,
      maxLastDeltaBytes: 700_000,
    });
  });

  it("keeps Chromium heap flat across StrictMode double-mount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        const view = render(
          <React.StrictMode>
            <KernelHarness seed={round * 200 + index} />
          </React.StrictMode>,
        );
        await act(async () => {
          view.getByTestId("kernel-memory").click();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 3_500_000,
      maxLastDeltaBytes: 850_000,
    });
  });

  it("keeps Chromium heap flat with concurrent component trees", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 4; index++) {
        const base = round * 400 + index * 4;
        const views = [
          render(<KernelHarness seed={base} />),
          render(<KernelHarness seed={base + 1} />),
          render(<KernelHarness seed={base + 2} />),
          render(<KernelHarness seed={base + 3} />),
        ];
        await act(async () => {
          for (const view of views) {
            // Scope to view.container — testing-library's default queries bind
            // to document.body, which would match buttons across all views.
            within(view.container).getByTestId("kernel-memory").click();
          }
        });
        for (const view of views) {
          view.unmount();
        }
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 900_000,
      maxTailHeadRatio: 1.8,
    });
  });
});
