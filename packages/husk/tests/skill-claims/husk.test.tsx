// Verifies the behavioural claims made by skills/supergrain/SKILL.md
// about the husk react hooks. Named after the skill sentence each one backs.

import { defineResource } from "@supergrain/husk";
import {
  modifier,
  useModifier,
  useReactivePromise,
  useReactiveTask,
  useResource,
} from "@supergrain/husk/react";
import { createReactive } from "@supergrain/kernel";
import { tracked, useReactive } from "@supergrain/kernel/react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

/** Let microtasks + any pending effect reruns settle. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

describe("SKILL: reactivity comes from reading reactive state", () => {
  it("a prop-keyed fetch never re-runs; the same fetch keyed off reactive state does", async () => {
    const viaProp: string[] = [];
    const viaState: string[] = [];

    // Reads a prop SCALAR — a copied-out value, not reactive state, so there
    // is nothing for the resource to subscribe to. Contrast the store-object
    // case below, which does stay reactive.
    const ByProp = tracked(({ projectId }: { projectId: string }) => {
      const tasks = useReactivePromise(async () => {
        viaProp.push(projectId);
        return `tasks-for-${projectId}`;
      });
      return <div data-testid="p">{tasks.data ?? "…"}</div>;
    });

    // Mirrors the prop into reactive state and reads that instead — the
    // remedy the skill prescribes.
    const ByState = tracked(({ projectId }: { projectId: string }) => {
      const sel = useReactive({ projectId });
      if (sel.projectId !== projectId) sel.projectId = projectId;

      const tasks = useReactivePromise(async () => {
        const id = sel.projectId; // reactive read, before the first await
        viaState.push(id);
        return `tasks-for-${id}`;
      });
      return <div data-testid="s">{tasks.data ?? "…"}</div>;
    });

    const Both = ({ projectId }: { projectId: string }) => (
      <>
        <ByProp projectId={projectId} />
        <ByState projectId={projectId} />
      </>
    );

    const { rerender } = render(<Both projectId="a" />);
    await waitFor(() => expect(screen.getByTestId("p").textContent).toBe("tasks-for-a"));
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("tasks-for-a"));

    rerender(<Both projectId="b" />);
    await waitFor(() => expect(screen.getByTestId("s").textContent).toBe("tasks-for-b"));
    await settle();

    // The prop-keyed one never refetched and still shows a's data.
    expect(viaProp).toEqual(["a"]);
    expect(screen.getByTestId("p").textContent).toBe("tasks-for-a");
    // The reactive-state one tracked the change.
    expect(viaState).toEqual(["a", "b"]);
  });
});

describe('SKILL: "A store object prop stays reactive"', () => {
  it("a field read THROUGH an object prop re-runs the captured callback", async () => {
    // The counterpart to the prop-scalar test above, and the half that had no
    // coverage: `useReactivePromise` captures its callback once, but the
    // closure holds the store object, so reading a field on it subscribes
    // normally and mutating that field re-runs the fetch.
    const store = createReactive({ project: { id: "a" } });
    const seen: string[] = [];

    const Tasks = tracked(({ project }: { project: { id: string } }) => {
      const tasks = useReactivePromise(async () => {
        const id = project.id; // reactive read through the prop object
        seen.push(id);
        return `tasks-for-${id}`;
      });
      return <div data-testid="o">{tasks.data ?? "…"}</div>;
    });

    render(<Tasks project={store.project} />);
    await waitFor(() => expect(screen.getByTestId("o").textContent).toBe("tasks-for-a"));

    await act(async () => {
      store.project.id = "b";
    });

    await waitFor(() => expect(screen.getByTestId("o").textContent).toBe("tasks-for-b"));
    await settle();
    expect(seen).toEqual(["a", "b"]);
  });
});

describe('SKILL: "useReactiveTask is unaffected" by the props trap', () => {
  it("a task always runs the LATEST render's closure, so a prop read in it is current", async () => {
    const seen: string[] = [];

    const Panel = tracked(({ projectId }: { projectId: string }) => {
      const save = useReactiveTask(async () => {
        seen.push(projectId); // prop read inside the task body
        return projectId;
      });
      return (
        <button data-testid="go" onClick={() => void save.run()}>
          save
        </button>
      );
    });

    const { rerender } = render(<Panel projectId="a" />);
    await act(async () => {
      screen.getByTestId("go").click();
    });
    expect(seen).toEqual(["a"]);

    // Change the prop, then run again. Unlike useReactivePromise, the task
    // calls through a ref refreshed on every render, so it sees "b".
    rerender(<Panel projectId="b" />);
    await act(async () => {
      screen.getByTestId("go").click();
    });
    expect(seen).toEqual(["a", "b"]);
  });
});

describe('SKILL: "reads before the first await change"', () => {
  it("a signal read BEFORE the first await re-runs the promise", async () => {
    const store = createReactive({ id: 1 });
    const calls: number[] = [];

    const C = tracked(() => {
      const r = useReactivePromise(async () => {
        const id = store.id; // sync prefix — tracked
        calls.push(id);
        await Promise.resolve();
        return id;
      });
      return <div data-testid="v">{r.data ?? "…"}</div>;
    });

    render(<C />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("1"));

    await act(async () => {
      store.id = 2;
    });
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("2"));
    expect(calls).toEqual([1, 2]);
  });

  it("a signal read only AFTER the first await does NOT re-run it", async () => {
    const store = createReactive({ id: 1 });
    const calls: number[] = [];

    const C = tracked(() => {
      const r = useReactivePromise(async () => {
        await Promise.resolve(); // everything past here is untracked
        const id = store.id;
        calls.push(id);
        return id;
      });
      return <div data-testid="v">{r.data ?? "…"}</div>;
    });

    render(<C />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("1"));

    await act(async () => {
      store.id = 2;
    });
    await settle();

    expect(calls).toEqual([1]); // never re-ran
    expect(screen.getByTestId("v").textContent).toBe("1"); // stale
  });
});

describe('SKILL: "useReactiveTask ... only run()"', () => {
  it("does not auto-run, runs on run(), and exposes the documented envelope", async () => {
    let ran = 0;

    let handle: unknown;
    const C = tracked(() => {
      const save = useReactiveTask(async (n: number) => {
        ran++;
        return n * 2;
      });
      handle = save;
      return (
        <>
          <div data-testid="pending">{String(save.isPending)}</div>
          <div data-testid="data">{save.data ?? "none"}</div>
          <button data-testid="go" onClick={() => void save.run(21)}>
            go
          </button>
        </>
      );
    });

    render(<C />);
    await settle();
    expect(ran).toBe(0); // no auto-run

    await act(async () => {
      screen.getByTestId("go").click();
    });
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("42"));
    expect(ran).toBe(1);

    // Documented envelope fields exist; refetch does not.
    const h = handle as Record<string, unknown>;
    for (const f of ["data", "error", "isPending", "isReady", "run"]) {
      expect(f in h).toBe(true);
    }
    expect(h["refetch"]).toBeUndefined();
    // A TASK has no `promise` — unlike a reactivePromise. So `use(task.promise)`
    // is not available for Suspense; only reactivePromise/silo handles have it.
    expect("promise" in h).toBe(false);
  });
});

describe('SKILL: "Only `createQuery` has `refetch`"', () => {
  it("a husk promise envelope has no refetch", async () => {
    let handle: unknown;
    const C = tracked(() => {
      const r = useReactivePromise(async () => 1);
      handle = r;
      return <div data-testid="v">{r.data ?? "…"}</div>;
    });

    render(<C />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("1"));

    const h = handle as Record<string, unknown>;
    expect(h["refetch"]).toBeUndefined();
    for (const f of ["data", "error", "isPending", "isReady", "promise"]) {
      expect(f in h).toBe(true);
    }
  });
});

describe('SKILL: "A resource has no envelope"', () => {
  it("useResource hands back the state object itself, with no .data/.isPending wrapper", async () => {
    const listing = defineResource(
      (): { items: string[] } => ({ items: [] }),
      async (state, args: { query: string }) => {
        state.items = [`hit-for-${args.query}`];
      },
    );

    let handle: unknown;
    const C = tracked(() => {
      const search = useReactive({ query: "a" });
      const docs = useResource(listing, () => ({ query: search.query }));
      handle = docs;
      return <div data-testid="v">{docs.items[0] ?? "…"}</div>;
    });

    render(<C />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("hit-for-a"));

    // The state object is what comes back — the envelope fields a
    // reactivePromise carries are absent, so `.data` is not the way in.
    const h = handle as Record<string, unknown>;
    expect(h["items"]).toEqual(["hit-for-a"]);
    for (const f of ["data", "error", "isPending", "isReady", "promise", "refetch"]) {
      expect(h[f]).toBeUndefined();
    }
  });
});

describe('SKILL: "signals in the body change — args do NOT re-attach"', () => {
  it("a signal read inside the modifier re-attaches WITHOUT re-rendering the component", async () => {
    const settings = createReactive({ flag: 0 });
    let attaches = 0;
    let componentRenders = 0;

    const track = modifier<HTMLDivElement, []>((_el) => {
      void settings.flag; // tracked read inside the modifier body
      attaches++;
      return () => {};
    });

    const C = tracked(() => {
      componentRenders++;
      return <div data-testid="el" ref={useModifier(track)} />;
    });

    render(<C />);
    await settle();
    expect(attaches).toBe(1);
    const rendersBefore = componentRenders;

    await act(async () => {
      settings.flag = 1;
    });
    await settle();

    expect(attaches).toBe(2); // re-attached
    expect(componentRenders).toBe(rendersBefore); // but did NOT re-render
  });

  it("changing an ARG does not re-attach", async () => {
    let attaches = 0;
    const seen: string[] = [];

    const track = modifier<HTMLDivElement, [string]>((_el, label) => {
      attaches++;
      seen.push(label);
      return () => {};
    });

    const C = tracked(({ label }: { label: string }) => (
      <div data-testid="el" ref={useModifier(track, label)} />
    ));

    const { rerender } = render(<C label="first" />);
    await settle();
    expect(attaches).toBe(1);

    rerender(<C label="second" />);
    await settle();

    expect(attaches).toBe(1); // no re-attach
    expect(seen).toEqual(["first"]);
  });
});

describe('SKILL: "`.data` (`null` until resolved)"', () => {
  it("is null — not undefined — before the promise settles", async () => {
    const seen: Array<{ data: unknown; isNull: boolean }> = [];

    const C = tracked(() => {
      const r = useReactivePromise(async () => {
        await new Promise((res) => setTimeout(res, 5));
        return { orderId: "o1" };
      });
      seen.push({ data: r.data, isNull: r.data === null });
      return <div data-testid="v">{r.data?.orderId ?? "…"}</div>;
    });

    render(<C />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("o1"));

    // The first observation is the unresolved one. `data !== undefined` would
    // NOT narrow it — the guard has to be against null.
    expect(seen[0]!.isNull).toBe(true);
    expect(seen[0]!.data).not.toBe(undefined);
    expect(seen.at(-1)!.data).toEqual({ orderId: "o1" });
  });
});

describe('SKILL: "the same, across call sites" shares the definition, not the state', () => {
  it("each useResource call site gets its own instance, bound to its own args", async () => {
    const seen: string[] = [];
    const lookup = defineResource(
      (): { name: string } => ({ name: "" }),
      async (state, args: { id: string }) => {
        seen.push(args.id);
        state.name = `supplier-${args.id}`;
      },
    );

    const Site = tracked(({ id }: { id: string }) => {
      const mirror = useReactive({ id });
      if (mirror.id !== id) mirror.id = id;
      const s = useResource(lookup, () => ({ id: mirror.id }));
      return <div data-testid={`s${id}`}>{s.name || "…"}</div>;
    });

    render(
      <>
        <Site id="a" />
        <Site id="b" />
      </>,
    );

    // Two call sites of ONE defineResource: separate state, separate args.
    await waitFor(() => expect(screen.getByTestId("sa").textContent).toBe("supplier-a"));
    await waitFor(() => expect(screen.getByTestId("sb").textContent).toBe("supplier-b"));
    expect(seen.sort()).toEqual(["a", "b"]);
  });
});
