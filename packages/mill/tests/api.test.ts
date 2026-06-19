import { describe, expect, it } from "vitest";

import * as mill from "../src";
import { update } from "../src";

// Pins the package's public surface: the single `update` entry point is exported
// from the barrel and is the same function whether imported by name or namespace.

describe("public API", () => {
  it("exports update", () => {
    expect(typeof update).toBe("function");
    expect(mill.update).toBe(update);
  });
});
