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

  it("exposes the documented public API from the package root", () => {
    // The full surface advertised by `index.ts` — store API, alien-signals
    // primitives we re-export, batch wrapper, and the profiler hooks.
    expect(typeof core.createReactive).toBe("function");
    expect(typeof core.unwrap).toBe("function");
    expect(core.$BRAND).toBeTypeOf("symbol");
    expect(core.$TRACK).toBeTypeOf("symbol");
    expect(typeof core.getNodesIfExist).toBe("function");

    expect(typeof core.effect).toBe("function");
    expect(typeof core.signal).toBe("function");
    expect(typeof core.computed).toBe("function");
    expect(typeof core.batch).toBe("function");

    expect(typeof core.enableProfiling).toBe("function");
    expect(typeof core.disableProfiling).toBe("function");
    expect(typeof core.resetProfiler).toBe("function");
    expect(typeof core.getProfile).toBe("function");
  });

  it("does not re-export raw alien-signals batch primitives", () => {
    // `batch()` is the safe wrapper. The raw counter-based primitives leak on
    // exception, so they must NOT appear at the package root.
    expect("startBatch" in core).toBe(false);
    expect("endBatch" in core).toBe(false);
    expect("getCurrentSub" in core).toBe(false);
    expect("setCurrentSub" in core).toBe(false);
  });

  it("does not re-export the operators package from the package root", () => {
    expect("update" in core).toBe(false);
  });
});
