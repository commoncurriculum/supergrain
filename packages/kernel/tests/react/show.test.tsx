import { createReactive } from "@supergrain/kernel";
import { tracked, Show } from "@supergrain/kernel/react";
import { render, act, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { flushMicrotasks } from "./test-utils";

describe("Show component", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders children when truthy, fallback when falsy", async () => {
    const store = createReactive({ loggedIn: false });

    const App = tracked(() => (
      <Show when={() => store.loggedIn} fallback={<p>Please log in</p>}>
        <p>Welcome back</p>
      </Show>
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

  it("renders nothing when falsy and no fallback is given", async () => {
    const store = createReactive({ visible: false });

    const App = tracked(() => (
      <Show when={() => store.visible}>
        <p>content</p>
      </Show>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("");

    await act(async () => {
      store.visible = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("content");
  });

  it("does not re-render parent or Show when condition inputs change without flipping", async () => {
    const store = createReactive({ count: 1 });
    let parentRenders = 0;
    let showBodyRenders = 0;

    const Body = tracked(() => {
      showBodyRenders++;
      return <p>non-empty</p>;
    });

    const App = tracked(() => {
      parentRenders++;
      return (
        <Show when={() => store.count > 0} fallback={<p>empty</p>}>
          <Body />
        </Show>
      );
    });

    const { container } = render(<App />);
    expect(container.textContent).toBe("non-empty");
    expect(parentRenders).toBe(1);
    expect(showBodyRenders).toBe(1);

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
    expect(showBodyRenders).toBe(1);
    expect(container.textContent).toBe("non-empty");

    // 3 → 0: flips to falsy — branch swaps, parent still untouched.
    await act(async () => {
      store.count = 0;
      await flushMicrotasks();
    });
    expect(parentRenders).toBe(1);
    expect(container.textContent).toBe("empty");
  });

  it("passes the narrowed value to function children", async () => {
    const store = createReactive<{ user: { name: string } | null }>({
      user: null, // eslint-disable-line unicorn/no-null -- modeling a logged-out state
    });

    const App = tracked(() => (
      <Show when={() => store.user} fallback={<p>anonymous</p>}>
        {(user) => <p>hello {user.name}</p>}
      </Show>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("anonymous");

    await act(async () => {
      store.user = { name: "Ada" };
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("hello Ada");
  });

  it("re-renders function children when the value changes while staying truthy", async () => {
    const store = createReactive<{ user: { name: string } | null }>({
      user: { name: "Ada" },
    });

    const App = tracked(() => (
      <Show when={() => store.user} fallback={<p>anonymous</p>}>
        {(user) => <p>hello {user.name}</p>}
      </Show>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("hello Ada");

    await act(async () => {
      store.user = { name: "Grace" };
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("hello Grace");
  });

  it("accepts a plain (non-function) when value", async () => {
    const App = ({ on }: { on: boolean }) => (
      <Show when={on} fallback={<p>off</p>}>
        <p>on</p>
      </Show>
    );

    const { container, rerender } = render(<App on={false} />);
    expect(container.textContent).toBe("off");

    rerender(<App on={true} />);
    expect(container.textContent).toBe("on");
  });

  it("tracks deep conditions across nested objects", async () => {
    const store = createReactive({ settings: { flags: { beta: false } } });

    const App = tracked(() => (
      <Show when={() => store.settings.flags.beta} fallback={<p>stable</p>}>
        <p>beta</p>
      </Show>
    ));

    const { container } = render(<App />);
    expect(container.textContent).toBe("stable");

    await act(async () => {
      store.settings.flags.beta = true;
      await flushMicrotasks();
    });
    expect(container.textContent).toBe("beta");
  });
});
