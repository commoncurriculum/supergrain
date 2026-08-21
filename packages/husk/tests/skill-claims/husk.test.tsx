// Verifies the behavioural claims made by .claude/skills/supergrain/SKILL.md
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

describe('SKILL: "Props are not signals"', () => {
  it("useReactivePromise keyed off a PROP never re-runs and keeps serving the first value", async () => {
    const calls: string[] = [];

    const Panel = tracked(({ projectId }: { projectId: string }) => {
      const tasks = useReactivePromise(async () => {
        calls.push(projectId);
        return `tasks-for-${projectId}`;
      });
      return <div data-testid="v">{tasks.data ?? "…"}</div>;
    });

    const { rerender } = render(<Panel projectId="a" />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("tasks-for-a"));
    expect(calls).toEqual(["a"]);

    // The prop genuinely changes...
    rerender(<Panel projectId="b" />);
    await settle();

    // ...and nothing refetches. The panel still shows project a's data.
    expect(calls).toEqual(["a"]);
    expect(screen.getByTestId("v").textContent).toBe("tasks-for-a");
  });

  it("useResource's args thunk keyed off a PROP also never re-runs", async () => {
    const calls: string[] = [];

    const fetchTasks = defineResource<string, { data: string | null }>(
      () => ({ data: null }),
      async (state, projectId) => {
        calls.push(projectId);
        state.data = `tasks-for-${projectId}`;
      },
    );

    const Panel = tracked(({ projectId }: { projectId: string }) => {
      const tasks = useResource(fetchTasks, () => projectId);
      return <div data-testid="v">{tasks.data ?? "…"}</div>;
    });

    const { rerender } = render(<Panel projectId="a" />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("tasks-for-a"));
    expect(calls).toEqual(["a"]);

    rerender(<Panel projectId="b" />);
    await settle();

    expect(calls).toEqual(["a"]);
    expect(screen.getByTestId("v").textContent).toBe("tasks-for-a");
  });

  it("mirroring the prop into reactive state DOES make it re-run (the skill's prescribed fix)", async () => {
    const calls: string[] = [];

    const Panel = tracked(({ projectId }: { projectId: string }) => {
      const state = useReactive({ projectId });
      state.projectId = projectId; // mirror prop -> signal

      const tasks = useReactivePromise(async () => {
        const id = state.projectId; // signal read in the sync prefix
        calls.push(id);
        return `tasks-for-${id}`;
      });
      return <div data-testid="v">{tasks.data ?? "…"}</div>;
    });

    const { rerender } = render(<Panel projectId="a" />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("tasks-for-a"));

    rerender(<Panel projectId="b" />);
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("tasks-for-b"));
    expect(calls).toEqual(["a", "b"]);
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

describe('SKILL: "Neither layer has refetch"', () => {
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
