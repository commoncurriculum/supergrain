// Verifies the silo claim in .claude/skills/supergrain/SKILL.md — specifically
// the fix it prescribes for the "props are not signals" trap.

import type { DocumentStore } from "@supergrain/silo";

import { tracked } from "@supergrain/kernel/react";
import { createDocumentStoreContext } from "@supergrain/silo/react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

type Models = { task: { id: string; title: string } };
type Store = DocumentStore<Models, Record<string, never>>;

describe('SKILL: "useDocument(\\"task\\", id) re-reads when id changes"', () => {
  it("a prop-keyed silo read DOES refetch when the prop changes", async () => {
    const calls: string[][] = [];

    const { Provider, useDocument } = createDocumentStoreContext<Store>();

    const config = {
      models: {
        task: {
          adapter: {
            find: (ids: readonly string[]) => {
              calls.push([...ids]);
              return Promise.resolve(ids.map((id) => ({ id, title: `task-${id}` })));
            },
          },
        },
      },
    };

    // projectId arrives as a PROP — the exact shape that silently breaks a
    // husk resource. Through silo it must re-read.
    const Panel = tracked(({ taskId }: { taskId: string }) => {
      const task = useDocument("task", taskId);
      return <div data-testid="v">{task.value?.title ?? "…"}</div>;
    });

    const { rerender } = render(
      <Provider config={config as never}>
        <Panel taskId="a" />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("task-a"));
    expect(calls.flat()).toEqual(["a"]);

    rerender(
      <Provider config={config as never}>
        <Panel taskId="b" />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("task-b"));
    expect(calls.flat()).toEqual(["a", "b"]);
  });

  it("a silo handle exposes .value/.isFetching/.status and has no refetch", async () => {
    let handle: unknown;
    const { Provider, useDocument } = createDocumentStoreContext<Store>();

    const config = {
      models: {
        task: {
          adapter: {
            find: (ids: readonly string[]) =>
              Promise.resolve(ids.map((id) => ({ id, title: `task-${id}` }))),
          },
        },
      },
    };

    const Panel = tracked(() => {
      const task = useDocument("task", "a");
      handle = task;
      return <div data-testid="v">{task.value?.title ?? "…"}</div>;
    });

    render(
      <Provider config={config as never}>
        <Panel />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("task-a"));

    const h = handle as Record<string, unknown>;
    for (const f of ["value", "error", "isFetching", "status", "promise"]) {
      expect(f in h).toBe(true);
    }
    expect(h["refetch"]).toBeUndefined();
    expect(h["data"]).toBeUndefined(); // silo uses .value, husk uses .data
  });
});

describe('SKILL: "a document whose id never changes has no refresh lever"', () => {
  it("insertDocument replaces the value a live handle is showing", async () => {
    let fetches = 0;
    const { Provider, useDocumentStore, useDocument } = createDocumentStoreContext<Store>();

    const config = {
      models: {
        task: {
          adapter: {
            find: (ids: readonly string[]) => {
              fetches += 1;
              return Promise.resolve(ids.map((id) => ({ id, title: `task-${id}` })));
            },
          },
        },
      },
    };

    let store: ReturnType<typeof useDocumentStore> | undefined;
    const Panel = tracked(() => {
      store = useDocumentStore();
      // The id is a constant, so nothing the handle tracks will ever change.
      const task = useDocument("task", "a");
      return <div data-testid="v">{task.value?.title ?? "…"}</div>;
    });

    render(
      <Provider config={config as never}>
        <Panel />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("task-a"));
    expect(fetches).toBe(1);

    // The documented lever: write the fresh document straight into the store.
    act(() => {
      store!.insertDocument("task", { id: "a", title: "refreshed" });
    });

    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("refreshed"));
    // No second find(): the handle updated because the store did, not by refetching.
    expect(fetches).toBe(1);
  });
});

describe('SKILL: "`.value` is `undefined` until it resolves"', () => {
  it("a pending handle has status pending, no value, and a promise to suspend on", async () => {
    const seen: Array<{ status: unknown; value: unknown; hasPromise: boolean }> = [];
    const { Provider, useDocument } = createDocumentStoreContext<Store>();

    const config = {
      models: {
        task: {
          adapter: {
            find: (ids: readonly string[]) =>
              Promise.resolve(ids.map((id) => ({ id, title: `task-${id}` }))),
          },
        },
      },
    };

    const Panel = tracked(() => {
      const task = useDocument("task", "a");
      seen.push({
        status: task.status,
        value: task.value,
        hasPromise: task.promise !== undefined,
      });
      return <div data-testid="v">{task.value?.title ?? "…"}</div>;
    });

    render(
      <Provider config={config as never}>
        <Panel />
      </Provider>,
    );
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("task-a"));

    // First observation is the pending state the `use(handle.promise!)` line
    // exists for: no value yet, but a promise to hand React.
    expect(seen[0]).toEqual({ status: "pending", value: undefined, hasPromise: true });
    expect(seen.at(-1)!.status).toBe("success");
  });
});
