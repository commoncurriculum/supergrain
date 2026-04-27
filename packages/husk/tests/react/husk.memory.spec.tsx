import { tracked } from "@supergrain/kernel/react";
import { collectBrowserSamples, expectBrowserTrend } from "@supergrain/test-utils/browser-memory";
import { cleanup, render, act } from "@testing-library/react";
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
  // The racy unmount-during-async case. The realistic-app test in silo waits
  // for async to settle between actions so it never quite hits this race
  // organically. This test specifically forces unmount before the in-flight
  // useReactivePromise resolves, validating the abort path's cleanup.
  it("keeps Chromium heap flat when component unmounts while async is still pending", async () => {
    const samples = await collectBrowserSamples(6, async (round) => {
      for (let index = 0; index < 25; index++) {
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
      maxGrowthBytes: 4_500_000,
      maxLastDeltaBytes: 1_000_000,
    });
  });
});
