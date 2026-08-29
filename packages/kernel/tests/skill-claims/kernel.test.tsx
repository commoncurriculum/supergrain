// Verifies the behavioural claims made by skills/supergrain/SKILL.md.
// Each test is named after the sentence in the skill it backs up, so a failure
// tells you which line of the skill has gone stale.

import { createReactive, stableComputed } from "@supergrain/kernel";
import { tracked, useComputed } from "@supergrain/kernel/react";
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

describe('SKILL: "Plain objects, arrays, Map, Set, Date proxy; RegExp ... do not"', () => {
  it("mutating a Date in place re-renders, and so does replacing it wholesale", async () => {
    const store = createReactive({ when: new Date(2020, 0, 1) });

    const C = tracked(() => <div data-testid="t">{store.when.getFullYear()}</div>);

    render(<C />);
    expect(screen.getByTestId("t").textContent).toBe("2020");

    await act(async () => {
      store.when.setFullYear(2030); // in-place mutation of a proxied Date
    });
    expect(screen.getByTestId("t").textContent).toBe("2030");

    await act(async () => {
      store.when = new Date(2040, 0, 1); // wholesale replacement
    });
    expect(screen.getByTestId("t").textContent).toBe("2040");
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

describe('SKILL: "A prop that is a store object stays reactive"', () => {
  it("a tracked child re-renders on a property change reached through a prop — and only that child", async () => {
    const store = createReactive({
      todos: [
        { id: 1, text: "a", done: false },
        { id: 2, text: "b", done: false },
      ],
    });
    const renders: Record<number, number> = { 1: 0, 2: 0 };

    // The prop is the reactive object itself, so `todo.done` inside the child
    // is an ordinary tracked read — the thing four cold builds hesitated over.
    const Row = tracked(({ todo }: { todo: { id: number; text: string; done: boolean } }) => {
      renders[todo.id] = (renders[todo.id] ?? 0) + 1;
      return <div data-testid={`r${todo.id}`}>{todo.done ? "done" : todo.text}</div>;
    });

    const List = tracked(() => (
      <>
        {store.todos.map((t) => (
          <Row key={t.id} todo={t} />
        ))}
      </>
    ));

    render(<List />);
    expect(screen.getByTestId("r1").textContent).toBe("a");
    const before = { ...renders };

    await act(async () => {
      store.todos[0]!.done = true;
    });

    expect(screen.getByTestId("r1").textContent).toBe("done");
    expect(renders[1]).toBeGreaterThan(before[1]!);
    // The sibling read nothing that changed, so it never re-rendered.
    expect(renders[2]).toBe(before[2]);
  });
});

describe('SKILL: "any in-place mutation notifies"', () => {
  it("splice, index assignment, and Set writes all notify; .length/.size/.has are tracked reads", async () => {
    const store = createReactive({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      picked: new Set<number>([1]),
    });
    let renders = 0;

    const C = tracked(() => {
      renders += 1;
      // every read here is the kind cold builds were unsure counted
      return (
        <div data-testid="v">
          {store.rows.length}:{store.rows[0]!.id}:{store.picked.size}:
          {store.picked.has(2) ? "y" : "n"}
        </div>
      );
    });

    render(<C />);
    expect(screen.getByTestId("v").textContent).toBe("3:1:1:n");

    await act(async () => {
      store.rows.splice(1, 1);
    });
    expect(screen.getByTestId("v").textContent).toBe("2:1:1:n");

    // index assignment — the swap idiom, not just property-through-index
    await act(async () => {
      const a = store.rows[0]!;
      store.rows[0] = store.rows[1]!;
      store.rows[1] = a;
    });
    expect(screen.getByTestId("v").textContent).toBe("2:3:1:n");

    await act(async () => {
      store.picked.add(2);
    });
    expect(screen.getByTestId("v").textContent).toBe("2:3:2:y");

    await act(async () => {
      store.picked.delete(1);
    });
    expect(screen.getByTestId("v").textContent).toBe("2:3:1:y");

    expect(renders).toBeGreaterThan(4);
  });
});
