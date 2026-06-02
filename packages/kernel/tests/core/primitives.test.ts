// =============================================================================
// primitives.test.ts
// =============================================================================
//
// Direct coverage for the kernel's owned reactive operator layer (`system.ts`):
// the `signal` / `computed` / `effect` / `effectScope` / `batch` primitives and
// the graph paths the proxy layer relies on — computed chains, diamonds, nested
// (child) effects, effect cleanup, and batched notification. These are a
// faithful port of alien-signals 3.x; the kernel's own React tests exercise them
// in the browser, so these node tests pin the same behavior where v8 coverage is
// collected.
// =============================================================================
import { describe, it, expect } from "vitest";

import { batch, computed, effect, signal } from "../../src";
import { effectScope } from "../../src/system";

describe("signal + effect", () => {
  it("re-runs an effect when a read signal changes", () => {
    const s = signal(0);
    const seen: Array<number> = [];
    const dispose = effect(() => {
      seen.push(s());
    });
    expect(seen).toEqual([0]);
    s(1);
    s(2);
    expect(seen).toEqual([0, 1, 2]);
    dispose();
    s(3);
    expect(seen).toEqual([0, 1, 2]); // no run after dispose
  });

  it("does not re-run when the written value is unchanged (Object.is)", () => {
    const s = signal(1);
    let runs = 0;
    effect(() => {
      void s();
      runs++;
    });
    s(1); // same value
    expect(runs).toBe(1);
  });

  it("supports a default-undefined signal", () => {
    const s = signal<number>();
    expect(s()).toBeUndefined();
    s(5);
    expect(s()).toBe(5);
  });
});

describe("computed", () => {
  it("computes lazily and caches until a dependency changes", () => {
    const s = signal(1);
    let computations = 0;
    const c = computed(() => {
      computations++;
      return s() * 2;
    });

    expect(c()).toBe(2);
    expect(c()).toBe(2); // cached
    expect(computations).toBe(1);

    s(5);
    expect(c()).toBe(10);
    expect(computations).toBe(2);
  });

  it("propagates through a chain of computeds into an effect", () => {
    const s = signal(1);
    const doubled = computed(() => s() * 2);
    const plusOne = computed(() => doubled() + 1);
    let observed = 0;
    effect(() => {
      observed = plusOne();
    });

    expect(observed).toBe(3);
    s(5);
    expect(observed).toBe(11);
  });

  it("recomputes a diamond once per source change", () => {
    const s = signal(1);
    const a = computed(() => s() + 1);
    const b = computed(() => s() + 10);
    let sum = 0;
    let runs = 0;
    effect(() => {
      runs++;
      sum = a() + b();
    });

    expect(sum).toBe(13);
    expect(runs).toBe(1);
    s(2);
    expect(sum).toBe(15);
    expect(runs).toBe(2); // single re-run despite two computed deps
  });

  it("skips recompute when a dependency settles back to an equal value", () => {
    const s = signal(2);
    const isEven = computed(() => s() % 2 === 0);
    let downstream = 0;
    const view = computed(() => {
      downstream++;
      return isEven() ? "even" : "odd";
    });

    expect(view()).toBe("even");
    expect(downstream).toBe(1);
    s(4); // still even — isEven unchanged, so `view` need not recompute
    expect(view()).toBe("even");
    expect(downstream).toBe(1);
  });
});

describe("computed with a child effect", () => {
  it("tears down a getter-spawned child effect on recompute", () => {
    const s = signal(0);
    const inner = signal(100);
    let innerRuns = 0;

    // A getter that spawns an effect makes the computed a parent (HasChildEffect);
    // each recompute must dispose the prior child before creating a new one.
    const c = computed(() => {
      effect(() => {
        void inner();
        innerRuns++;
      });
      return s();
    });

    const dispose = effect(() => {
      void c();
    });
    expect(innerRuns).toBe(1);

    s(1); // recompute → old child torn down, fresh child created
    expect(innerRuns).toBe(2);

    dispose();
  });
});

describe("computed teardown", () => {
  it("disposes a computed's own dependencies when its last reader goes away", () => {
    const s = signal(1);
    let computations = 0;
    const c = computed(() => {
      computations++;
      return s() * 2;
    });

    const dispose = effect(() => {
      void c();
    });
    expect(computations).toBe(1);

    // Disposing the only reader leaves the computed with no subscribers, so it
    // releases its dependency on `s` — a later write must not recompute it.
    dispose();
    s(2);
    expect(computations).toBe(1);

    // Reading it again recomputes lazily against the current source value.
    expect(c()).toBe(4);
    expect(computations).toBe(2);
  });
});

describe("effect cleanup", () => {
  it("a cleanup that disposes the effect halts further runs", () => {
    const s = signal(0);
    let runs = 0;
    // eslint-disable-next-line prefer-const -- assigned after effect() returns
    let dispose: () => void;
    dispose = effect(() => {
      runs++;
      void s();
      return () => {
        if (runs >= 2) dispose();
      };
    });

    s(1); // re-run #2; its cleanup disposes the effect
    s(2); // no further run
    expect(runs).toBe(2);
  });

  it("runs the returned cleanup before each re-run and once on dispose", () => {
    const s = signal(0);
    const cleanups: Array<number> = [];
    const dispose = effect(() => {
      const v = s();
      return () => cleanups.push(v);
    });

    s(1); // cleanup(0) before re-run
    s(2); // cleanup(1) before re-run
    expect(cleanups).toEqual([0, 1]);

    dispose(); // cleanup(2) on dispose
    expect(cleanups).toEqual([0, 1, 2]);
  });
});

describe("nested (child) effects", () => {
  it("disposes and recreates a child effect when the parent re-runs", () => {
    const outer = signal(0);
    const inner = signal(100);
    const log: Array<string> = [];

    const dispose = effect(() => {
      log.push(`outer:${outer()}`);
      effect(() => {
        log.push(`inner:${inner()}`);
      });
    });

    expect(log).toEqual(["outer:0", "inner:100"]);

    // Inner signal change re-runs only the child effect.
    inner(101);
    expect(log).toEqual(["outer:0", "inner:100", "inner:101"]);

    // Parent re-run tears down the old child and makes a fresh one.
    outer(1);
    expect(log).toEqual(["outer:0", "inner:100", "inner:101", "outer:1", "inner:101"]);

    dispose();
    inner(102);
    outer(2);
    expect(log).toEqual(["outer:0", "inner:100", "inner:101", "outer:1", "inner:101"]);
  });
});

describe("batch", () => {
  it("coalesces multiple writes into a single effect run", () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    let sum = 0;
    effect(() => {
      runs++;
      sum = a() + b();
    });
    expect(runs).toBe(1);

    batch(() => {
      a(1);
      b(2);
    });

    expect(runs).toBe(2); // one re-run for both writes
    expect(sum).toBe(3);
  });

  it("nested batches flush only at the outermost boundary", () => {
    const s = signal(0);
    let runs = 0;
    effect(() => {
      void s();
      runs++;
    });

    batch(() => {
      s(1);
      batch(() => {
        s(2);
      });
      expect(runs).toBe(1); // still inside the outer batch — no flush yet
    });

    expect(runs).toBe(2);
  });
});

describe("effectScope", () => {
  it("disposes all effects created within the scope at once", () => {
    const a = signal(0);
    const b = signal(0);
    let aRuns = 0;
    let bRuns = 0;

    const disposeScope = effectScope(() => {
      effect(() => {
        void a();
        aRuns++;
      });
      effect(() => {
        void b();
        bRuns++;
      });
    });

    expect(aRuns).toBe(1);
    expect(bRuns).toBe(1);

    a(1);
    b(1);
    expect(aRuns).toBe(2);
    expect(bRuns).toBe(2);

    disposeScope();
    a(2);
    b(2);
    expect(aRuns).toBe(2); // scope disposed → no more runs
    expect(bRuns).toBe(2);
  });

  it("disposing a child effect directly unlinks it from its parent", () => {
    const a = signal(0);
    let childRuns = 0;
    let childDispose: (() => void) | undefined;

    const parentDispose = effect(() => {
      void a();
      childDispose = effect(() => {
        childRuns++;
      });
    });
    expect(childRuns).toBe(1);

    // Dispose the child directly (it has the parent as a subscriber) — this
    // exercises the scope-operator's own-subscriber unlink path.
    childDispose!();
    parentDispose();
  });

  it("a scope created inside an effect becomes a child and is torn down with it", () => {
    const a = signal(0);
    let runs = 0;

    const disposeOuter = effect(() => {
      void a(); // re-runs the outer effect, which recreates the nested scope
      effectScope(() => {
        effect(() => {
          void a();
          runs++;
        });
      });
    });

    expect(runs).toBe(1);
    a(1); // outer re-runs → old scope (and its effect) disposed, fresh ones made
    expect(runs).toBe(2);

    disposeOuter();
    a(2);
    expect(runs).toBe(2);
  });
});
