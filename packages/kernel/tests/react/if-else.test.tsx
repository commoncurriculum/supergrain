import { createReactive } from "@supergrain/kernel";
import { tracked, If, ElseIf, Else } from "@supergrain/kernel/react";
import { render, act, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { flushMicrotasks } from "./test-utils";

describe("If/Else components", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders the then branch when truthy, the Else branch when falsy", async () => {
    const store = createReactive({ loggedIn: false });

    const App = tracked(() => (
      <If when={() => store.loggedIn}>
        <p>Welcome back</p>
        <Else>
          <p>Please log in</p>
        </Else>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("Please log in");

    await act(async () => {
      store.loggedIn = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("Welcome back");

    await act(async () => {
      store.loggedIn = false;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("Please log in");
  });

  it("renders nothing when falsy and no Else is given", async () => {
    const store = createReactive({ visible: false });

    const App = tracked(() => (
      <If when={() => store.visible}>
        <p>content</p>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("");

    await act(async () => {
      store.visible = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("content");
  });

  it("does not re-render parent or If when condition inputs change without flipping", async () => {
    const store = createReactive({ count: 1 });
    let parentRenders = 0;
    let bodyRenders = 0;

    const Body = tracked(() => {
      bodyRenders++;
      return <p>non-empty</p>;
    });

    const App = tracked(() => {
      parentRenders++;
      return (
        <If when={() => store.count > 0}>
          <Body />
          <Else>
            <p>empty</p>
          </Else>
        </If>
      );
    });

    const { container } = render(<App />);
    expect(container.textContent).toBe("non-empty");
    expect(parentRenders).toBe(1);
    expect(bodyRenders).toBe(1);

    // 1 → 2 → 3: still truthy, nothing should re-render.
    await act(async () => {
      store.count = 2;
      await flushMicrotasks();
    });
    await act(async () => {
      store.count = 3;
      await flushMicrotasks();
    });
    expect(parentRenders).toBe(1);
    expect(bodyRenders).toBe(1);
    expect(container.textContent).toBe("non-empty");

    // 3 → 0: flips to falsy — branch swaps, parent still untouched.
    await act(async () => {
      store.count = 0;
      await flushMicrotasks();
    });
    expect(parentRenders).toBe(1);
    expect(container.textContent).toBe("empty");
  });

  it("passes the narrowed value to a function child", async () => {
    const store = createReactive<{ user: { name: string } | null }>({
      user: null, // eslint-disable-line unicorn/no-null -- modeling a logged-out state
    });

    const App = tracked(() => (
      <If when={() => store.user}>
        {(user) => <p>hello {user.name}</p>}
        <Else>
          <p>anonymous</p>
        </Else>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("anonymous");

    await act(async () => {
      store.user = { name: "Ada" };
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("hello Ada");
  });

  it("re-renders a function child when the value changes while staying truthy", async () => {
    const store = createReactive<{ user: { name: string } | null }>({
      user: { name: "Ada" },
    });

    const App = tracked(() => (
      <If when={() => store.user}>
        {(user) => <p>hello {user.name}</p>}
        <Else>
          <p>anonymous</p>
        </Else>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("hello Ada");

    await act(async () => {
      store.user = { name: "Grace" };
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("hello Grace");
  });

  it("accepts a plain (non-function) when value", () => {
    const App = ({ on }: { on: boolean }) => (
      <If when={on}>
        <p>on</p>
        <Else>
          <p>off</p>
        </Else>
      </If>
    );

    const { container, rerender } = render(<App on={false} />);
    expect(container.textContent).toBe("off");

    rerender(<App on={true} />);
    expect(container.textContent).toBe("on");
  });

  it("tracks deep conditions across nested objects", async () => {
    const store = createReactive({ settings: { flags: { beta: false } } });

    const App = tracked(() => (
      <If when={() => store.settings.flags.beta}>
        <p>beta</p>
        <Else>
          <p>stable</p>
        </Else>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("stable");

    await act(async () => {
      store.settings.flags.beta = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("beta");
  });

  it("finds Else through fragment wrappers", async () => {
    const store = createReactive({ ok: false });

    const App = tracked(() => (
      <If when={() => store.ok}>
        <>
          <p>then-a</p>
          <p>then-b</p>
        </>
        <>
          <Else>
            <p>else-branch</p>
          </Else>
        </>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("else-branch");

    await act(async () => {
      store.ok = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("then-athen-b");
  });

  it("preserves then-branch order around an Else in the middle", async () => {
    const store = createReactive({ ok: true });

    const App = tracked(() => (
      <If when={() => store.ok}>
        <p>a</p>
        <Else>
          <p>e</p>
        </Else>
        <p>b</p>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("ab");

    await act(async () => {
      store.ok = false;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("e");
  });

  it("renders nothing when Else is used outside an If", () => {
    const { container } = render(
      <Else>
        <p>stray</p>
      </Else>,
    );
    expect(container.textContent).toBe("");
  });

  it("chains through ElseIf branches, first truthy wins", async () => {
    const store = createReactive<{ status: "loading" | "error" | "ready" }>({
      status: "loading",
    });

    const App = tracked(() => (
      <If when={() => store.status === "loading"}>
        <p>spinner</p>
        <ElseIf when={() => store.status === "error"}>
          <p>error-pane</p>
        </ElseIf>
        <Else>
          <p>content</p>
        </Else>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("spinner");

    await act(async () => {
      store.status = "error";
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("error-pane");

    await act(async () => {
      store.status = "ready";
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("content");

    await act(async () => {
      store.status = "loading";
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("spinner");
  });

  it("renders the earlier branch when several conditions are truthy", async () => {
    const store = createReactive({ a: true, b: true });

    const App = tracked(() => (
      <If when={() => store.a}>
        <p>first</p>
        <ElseIf when={() => store.b}>
          <p>second</p>
        </ElseIf>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("first");

    await act(async () => {
      store.a = false;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("second");
  });

  it("renders nothing when no branch matches and no Else is given", async () => {
    const store = createReactive({ a: false, b: false });

    const App = tracked(() => (
      <If when={() => store.a}>
        <p>first</p>
        <ElseIf when={() => store.b}>
          <p>second</p>
        </ElseIf>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("");

    await act(async () => {
      store.b = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("second");
  });

  it("short-circuits: a later ElseIf's inputs are not even subscribed while an earlier branch holds", async () => {
    const store = createReactive({ a: true, b: false });
    let parentRenders = 0;
    let bodyRenders = 0;

    const Body = tracked(() => {
      bodyRenders++;
      return <p>first</p>;
    });

    const App = tracked(() => {
      parentRenders++;
      return (
        <If when={() => store.a}>
          <Body />
          <ElseIf when={() => store.b}>
            <p>second</p>
          </ElseIf>
        </If>
      );
    });

    const { container } = render(<App />);
    expect(container.textContent).toBe("first");
    expect(parentRenders).toBe(1);
    expect(bodyRenders).toBe(1);

    // While `a` holds, flipping `b` back and forth is invisible — the chain
    // never read it, so there's no subscription and no re-render at all.
    await act(async () => {
      store.b = true;
      await flushMicrotasks();
    });
    await act(async () => {
      store.b = false;
      await flushMicrotasks();
    });
    expect(parentRenders).toBe(1);
    expect(bodyRenders).toBe(1);
    expect(container.textContent).toBe("first");

    // Once `a` drops, the chain picks up b's current value...
    await act(async () => {
      store.b = true;
      await flushMicrotasks();
    });
    await act(async () => {
      store.a = false;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("second");

    // ...and is now subscribed to it.
    await act(async () => {
      store.b = false;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("");
    expect(parentRenders).toBe(1);
  });

  it("does not re-render when an active ElseIf's inputs change without changing the branch", async () => {
    const store = createReactive({ loading: false, errors: 1 });
    let parentRenders = 0;

    const App = tracked(() => {
      parentRenders++;
      return (
        <If when={() => store.loading}>
          <p>spinner</p>
          <ElseIf when={() => store.errors > 0}>
            <p>error-pane</p>
          </ElseIf>
          <Else>
            <p>content</p>
          </Else>
        </If>
      );
    });

    const { container } = render(<App />);
    expect(container.textContent).toBe("error-pane");
    expect(parentRenders).toBe(1);

    // 1 → 2 → 5 errors: same branch, nothing re-renders.
    await act(async () => {
      store.errors = 2;
      await flushMicrotasks();
    });
    await act(async () => {
      store.errors = 5;
      await flushMicrotasks();
    });
    expect(parentRenders).toBe(1);
    expect(container.textContent).toBe("error-pane");

    await act(async () => {
      store.errors = 0;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("content");
    expect(parentRenders).toBe(1);
  });

  it("passes the narrowed value to an ElseIf function child", async () => {
    const store = createReactive<{
      loading: boolean;
      error: { message: string } | null;
    }>({
      loading: true,
      error: null, // eslint-disable-line unicorn/no-null -- modeling an empty error slot
    });

    const App = tracked(() => (
      <If when={() => store.loading}>
        <p>spinner</p>
        <ElseIf when={() => store.error}>{(error) => <p>failed: {error.message}</p>}</ElseIf>
        <Else>
          <p>content</p>
        </Else>
      </If>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("spinner");

    await act(async () => {
      store.loading = false;
      store.error = { message: "boom" };
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("failed: boom");

    await act(async () => {
      store.error = null; // eslint-disable-line unicorn/no-null -- clearing the error slot
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("content");
  });

  it("renders nothing when ElseIf is used outside an If", () => {
    const { container } = render(
      <ElseIf when={true}>
        <p>stray</p>
      </ElseIf>,
    );
    expect(container.textContent).toBe("");
  });
});
