// Verifies the behavioural claims made by .claude/skills/supergrain/SKILL.md.
// Each test is named after the sentence in the skill it backs up, so a failure
// tells you which line of the skill has gone stale.

import { createReactive, stableComputed } from "@supergrain/kernel";
import { For, tracked, useComputed } from "@supergrain/kernel/react";
import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

/** Counts renders of the component it's called in. */
function useRenderCount(): number {
  const n = useRef(0);
  n.current++;
  return n.current;
}

describe('SKILL: "Untracked reads subscribe to nothing"', () => {
  it("an untracked component does NOT re-render when a store value it read changes", async () => {
    const store = createReactive({ count: 0 });

    // Deliberately NOT wrapped in tracked(), and with no tracked ancestor that
    // could re-render it from above.
    const Untracked = () => {
      const renders = useRenderCount();
      return (
        <>
          <div data-testid="value">{store.count}</div>
          <div data-testid="renders">{renders}</div>
        </>
      );
    };

    render(<Untracked />);
    expect(screen.getByTestId("value").textContent).toBe("0");

    await act(async () => {
      store.count = 42;
    });

    // The store really did change...
    expect(store.count).toBe(42);
    // ...but the DOM is stale and no re-render happened.
    expect(screen.getByTestId("value").textContent).toBe("0");
    expect(screen.getByTestId("renders").textContent).toBe("1");
  });

  it("the same component wrapped in tracked() DOES re-render", async () => {
    const store = createReactive({ count: 0 });

    const Tracked = tracked(() => <div data-testid="value">{store.count}</div>);

    render(<Tracked />);
    expect(screen.getByTestId("value").textContent).toBe("0");

    await act(async () => {
      store.count = 42;
    });

    expect(screen.getByTestId("value").textContent).toBe("42");
  });
});

describe('SKILL: "useComputed ... returns the value, not a wrapper"', () => {
  it("hands back the raw value, usable directly in JSX", async () => {
    const store = createReactive({ a: 2, b: 3 });
    let observed: unknown;

    const C = tracked(() => {
      const sum = useComputed(() => store.a + store.b);
      observed = sum;
      return <div data-testid="sum">{sum}</div>;
    });

    render(<C />);
    expect(observed).toBe(5);
    expect(typeof observed).toBe("number"); // not a signal/getter/wrapper
    expect(screen.getByTestId("sum").textContent).toBe("5");

    await act(async () => {
      store.a = 10;
    });
    expect(screen.getByTestId("sum").textContent).toBe("13");
  });
});

describe('SKILL: "A derived array feeding <For> needs stableComputed"', () => {
  it("useComputed returns a FRESH array reference on each recompute", async () => {
    const store = createReactive({ tasks: [{ id: 1, done: false }], tick: 0 });
    const seen: Array<ReadonlyArray<unknown>> = [];

    const C = tracked(() => {
      const open = useComputed(() => {
        void store.tick; // force recompute without changing the result
        return store.tasks.filter((t) => !t.done);
      });
      seen.push(open);
      return <div data-testid="n">{open.length}</div>;
    });

    render(<C />);
    await act(async () => {
      store.tick++;
    });

    // Recomputed to an equal list, but a different reference each time —
    // which is precisely what defeats <For>'s per-item tracking.
    const distinct = new Set(seen);
    expect(seen.length).toBeGreaterThan(1);
    expect(distinct.size).toBe(seen.length);
  });

  it("stableComputed is a GETTER you call, and keeps one stable reference", () => {
    const store = createReactive({ tasks: [{ id: 1, done: false }], tick: 0 });

    const view = stableComputed(() => {
      void store.tick;
      return store.tasks.filter((t) => !t.done);
    });

    // It is callable, not a value.
    expect(typeof view).toBe("function");

    const first = view();
    store.tick++;
    const second = view();

    expect(first).toBe(second); // same reference across recomputes
    expect(second.length).toBe(1);
  });

  it("the useMemo(() => stableComputed(...)) pattern the skill shows actually renders", async () => {
    const store = createReactive({
      tasks: [
        { id: 1, title: "a", done: false },
        { id: 2, title: "b", done: true },
      ],
    });

    const Row = tracked(({ task }: { task: { id: number; title: string } }) => (
      <li data-testid={`row-${task.id}`}>{task.title}</li>
    ));

    const C = tracked(() => {
      // Built once, called at the read site — exactly as the skill prescribes.
      const visible = useRef(stableComputed(() => store.tasks.filter((t) => !t.done))).current;
      return (
        <ul>
          <For each={visible()}>{(task) => <Row task={task} />}</For>
        </ul>
      );
    });

    render(<C />);
    expect(screen.getByTestId("row-1")).toBeTruthy();
    expect(screen.queryByTestId("row-2")).toBeNull();

    await act(async () => {
      store.tasks[1]!.done = false; // b becomes visible
    });
    expect(screen.getByTestId("row-2")).toBeTruthy();
  });
});

describe('SKILL: "tracked() wraps in React.memo"', () => {
  it("a tracked child does not re-render when the parent re-renders with equal props", async () => {
    const store = createReactive({ parentOnly: 0 });
    let childRenders = 0;

    const Child = tracked(({ label }: { label: string }) => {
      childRenders++;
      return <div data-testid="child">{label}</div>;
    });

    const Parent = tracked(() => (
      <>
        <div data-testid="p">{store.parentOnly}</div>
        <Child label="stable" />
      </>
    ));

    render(<Parent />);
    expect(childRenders).toBe(1);

    await act(async () => {
      store.parentOnly = 1;
    });

    expect(screen.getByTestId("p").textContent).toBe("1"); // parent did re-render
    expect(childRenders).toBe(1); // child was memoized away
  });

  it("but a fresh inline object prop defeats it", async () => {
    const store = createReactive({ parentOnly: 0 });
    let childRenders = 0;

    const Child = tracked(({ cfg }: { cfg: { label: string } }) => {
      childRenders++;
      return <div>{cfg.label}</div>;
    });

    const Parent = tracked(() => (
      <>
        <div data-testid="p">{store.parentOnly}</div>
        <Child cfg={{ label: "fresh each render" }} />
      </>
    ));

    render(<Parent />);
    expect(childRenders).toBe(1);

    await act(async () => {
      store.parentOnly = 1;
    });

    expect(childRenders).toBe(2);
  });
});

describe('SKILL: "Plain objects, arrays, Map, Set proxy; Date ... do not"', () => {
  it("mutating a Date in place does not re-render; replacing it wholesale does", async () => {
    const store = createReactive({ when: new Date(2020, 0, 1) });

    const C = tracked(() => <div data-testid="t">{store.when.getFullYear()}</div>);

    render(<C />);
    expect(screen.getByTestId("t").textContent).toBe("2020");

    await act(async () => {
      store.when.setFullYear(2030); // in-place mutation of a non-proxied value
    });
    expect(screen.getByTestId("t").textContent).toBe("2020"); // stale, as documented

    await act(async () => {
      store.when = new Date(2030, 0, 1); // wholesale replacement
    });
    expect(screen.getByTestId("t").textContent).toBe("2030");
  });

  it("a Map IS tracked", async () => {
    const store = createReactive({ m: new Map<string, number>([["a", 1]]) });

    const C = tracked(() => <div data-testid="m">{store.m.get("a")}</div>);

    render(<C />);
    expect(screen.getByTestId("m").textContent).toBe("1");

    await act(async () => {
      store.m.set("a", 2);
    });
    expect(screen.getByTestId("m").textContent).toBe("2");
  });
});
