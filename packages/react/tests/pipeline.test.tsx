import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import React, { useRef } from "react";
import { createStore } from "@supergrain/core";
import { useDirectBindings, $$ } from "../src";

describe("Full pipeline: $$() to DOM", () => {
  afterEach(() => cleanup());

  it("hand-written compiler output updates DOM on signal change", async () => {
    const [store] = createStore({ title: "hello", count: 0 });

    // This is exactly what the compiler produces from:
    // <div>{$$(store.title)}</div>
    function Compiled() {
      const __$$0 = useRef<HTMLDivElement>(null);
      useDirectBindings([{ ref: __$$0, getter: () => store.title }]);
      return <div ref={__$$0}>{store.title}</div>;
    }

    const { container } = render(<Compiled />);
    expect(container.textContent).toBe("hello");

    await act(async () => {
      store.title = "world";
    });
    expect(container.textContent).toBe("world");
  });

  it("className binding updates on signal change", async () => {
    const [store] = createStore({ active: false });

    function Compiled() {
      const __$$0 = useRef<HTMLDivElement>(null);
      useDirectBindings([
        {
          ref: __$$0,
          getter: () => (store.active ? "active" : ""),
          attr: "className",
        },
      ]);
      return (
        <div ref={__$$0} className={store.active ? "active" : ""}>
          test
        </div>
      );
    }

    const { container } = render(<Compiled />);
    expect(container.querySelector("div")!.className).toBe("");

    await act(async () => {
      store.active = true;
    });
    expect(container.querySelector("div")!.className).toBe("active");
  });

  it("$$() identity function works without compiler", () => {
    // Without the compiler, $$() is an identity function
    expect($$(42)).toBe(42);
    expect($$("hello")).toBe("hello");
    expect($$(null)).toBe(null);
  });

  it("multiple bindings on same component", async () => {
    const [store] = createStore({ name: "Alice", role: "admin" });

    function Compiled() {
      const __$$0 = useRef<HTMLSpanElement>(null);
      const __$$1 = useRef<HTMLSpanElement>(null);
      useDirectBindings([
        { ref: __$$0, getter: () => store.name },
        { ref: __$$1, getter: () => store.role },
      ]);
      return (
        <div>
          <span ref={__$$0}>{store.name}</span>
          <span ref={__$$1}>{store.role}</span>
        </div>
      );
    }

    const { container } = render(<Compiled />);
    const spans = container.querySelectorAll("span");
    expect(spans[0].textContent).toBe("Alice");
    expect(spans[1].textContent).toBe("admin");

    await act(async () => {
      store.name = "Bob";
    });
    expect(spans[0].textContent).toBe("Bob");
    expect(spans[1].textContent).toBe("admin");

    await act(async () => {
      store.role = "user";
    });
    expect(spans[1].textContent).toBe("user");
  });
});
