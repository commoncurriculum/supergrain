// Imports the pure styles module directly (no JSX) so it runs in the node
// project, where `document` is undefined — exercising injectStyles' SSR guard.
import { describe, expect, it } from "vitest";

import { injectStyles, STATUS_COLOR, STYLE_ID } from "../src/react/styles";

describe("injectStyles (SSR)", () => {
  it("no-ops when there is no document", () => {
    expect(typeof document).toBe("undefined");
    expect(() => injectStyles()).not.toThrow();
  });

  it("exposes a stable style id and status palette", () => {
    expect(STYLE_ID).toBe("supergrain-devtools-styles");
    expect(STATUS_COLOR.success).toMatch(/^#/);
    expect(STATUS_COLOR.error).toMatch(/^#/);
    expect(STATUS_COLOR.fetching).toMatch(/^#/);
    expect(STATUS_COLOR.pending).toMatch(/^#/);
  });
});
