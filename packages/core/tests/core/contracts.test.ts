import { describe, expect, it } from "vitest";
import * as core from "../../src";

describe("core package contracts", () => {
  it("does not expose internal symbols from the package root", () => {
    expect("$NODE" in core).toBe(false);
    expect("$RAW" in core).toBe(false);
    expect("$PROXY" in core).toBe(false);
    expect("$OWN_KEYS" in core).toBe(false);
    expect("$VERSION" in core).toBe(false);
    expect("setProperty" in core).toBe(false);
  });

  it("exposes supported public API from the package root", () => {
    expect(typeof core.createStore).toBe("function");
    expect(typeof core.unwrap).toBe("function");
    expect(typeof core.update).toBe("function");
    expect(core.$BRAND).toBeTypeOf("symbol");
  });
});
