import { tracked } from "@supergrain/kernel/react";
import { collectBrowserSamples, expectBrowserTrend } from "@supergrain/test-utils/browser-memory";
import { cleanup, render, act } from "@testing-library/react";
import React from "react";
import { afterEach, describe, it } from "vitest";

import { useReactivePromise, useResource } from "../../src/react";

afterEach(() => cleanup());

interface HuskPayload {
  label: string;
  values: Array<number>;
}

function makePayload(seed: number, width = 18): Array<HuskPayload> {
  return Array.from({ length: width }, (_, index) => ({
    label: `payload-${seed}-${index}`,
    values: Array.from({ length: 14 }, (__, offset) => seed + index + offset),
  }));
}

const HuskHarness = tracked(function HuskHarness({ seed }: { seed: number }) {
  const resourceState = useResource({ cursor: 0, payload: makePayload(seed) }, (state) => {
    state.payload = makePayload(seed);
    return () => {
      state.payload = [];
    };
  });

  const promiseState = useReactivePromise(async (abortSignal) => {
    const current = resourceState.cursor;
    await Promise.resolve();
    if (abortSignal.aborted) return { label: "aborted", total: -1 };
    return {
      label: resourceState.payload[current]!.label,
      total: resourceState.payload[current]!.values.reduce((sum, value) => sum + value, 0),
    };
  });

  return (
    <button
      data-testid="husk-memory"
      type="button"
      onClick={() => {
        resourceState.cursor = (resourceState.cursor + 1) % resourceState.payload.length;
      }}
    >
      {promiseState.isReady ? promiseState.data?.total : resourceState.payload.length}
    </button>
  );
});

describe("husk react memory", () => {
  it("keeps Chromium heap flat when component unmounts while async is still pending", async () => {
    // Mounts the harness, triggers a click (which starts a reactivePromise rerun),
    // then immediately unmounts before the promise resolves.
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        const view = render(<HuskHarness seed={round * 100 + index} />);
        // Click without waiting — unmount races the in-flight promise
        view.getByTestId("husk-memory").click();
        view.unmount();
        // Drain microtasks so aborted promises settle
        await act(async () => {
          await Promise.resolve();
        });
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 3_500_000,
      maxLastDeltaBytes: 850_000,
    });
  });

  it("keeps Chromium heap flat across repeated remounts with changing seed props", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 8; index++) {
        // Render with one seed then rerender with a different seed to exercise
        // prop-change teardown/setup within the same DOM container.
        const view = render(<HuskHarness seed={round * 200 + index * 2} />);
        await act(async () => {
          view.rerender(<HuskHarness seed={round * 200 + index * 2 + 1} />);
          await Promise.resolve();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 900_000,
      maxTailHeadRatio: 1.8,
    });
  });

  it("keeps Chromium heap flat across StrictMode double-mount churn", async () => {
    const samples = await collectBrowserSamples(5, async (round) => {
      for (let index = 0; index < 6; index++) {
        const view = render(
          <React.StrictMode>
            <HuskHarness seed={round * 300 + index} />
          </React.StrictMode>,
        );
        await act(async () => {
          view.getByTestId("husk-memory").click();
          await Promise.resolve();
        });
        view.unmount();
      }
      cleanup();
    });

    expectBrowserTrend(samples, {
      maxGrowthBytes: 4_000_000,
      maxLastDeltaBytes: 950_000,
    });
  });
});
