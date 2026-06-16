import { serialize } from "@supergrain/devtools";
import { JsonView } from "@supergrain/devtools/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

describe("<JsonView />", () => {
  it("renders every leaf kind", () => {
    const node = serialize({
      s: "hi",
      b: true,
      nul: null,
      undef: undefined,
      big: 10n,
      sym: Symbol("z"),
      fn: function named() {},
      d: new Date(0),
    });
    render(<JsonView node={node} />);
    expect(screen.getByText('"hi"')).toBeTruthy();
    expect(screen.getByText("true")).toBeTruthy();
    expect(screen.getByText("null")).toBeTruthy();
    expect(screen.getByText("undefined")).toBeTruthy();
    expect(screen.getByText("10n")).toBeTruthy();
    expect(screen.getByText("Symbol(z)")).toBeTruthy();
    expect(screen.getByText(/named/)).toBeTruthy();
  });

  it("renders array, map, set, and error composites with their children", () => {
    const { rerender } = render(<JsonView node={serialize([10, 20, 30])} />);
    expect(screen.getByText(/Array\(3\)/)).toBeTruthy();
    expect(screen.getByText("20")).toBeTruthy();

    rerender(<JsonView node={serialize(new Map([["k", 1]]))} />);
    expect(screen.getByText(/Map\(1\)/)).toBeTruthy();

    rerender(<JsonView node={serialize(new Set([7]))} />);
    expect(screen.getByText(/Set\(1\)/)).toBeTruthy();

    const error = Object.assign(new Error("boom"), { _tag: "AdapterError" });
    rerender(<JsonView node={serialize(error)} />);
    expect(screen.getByText(/AdapterError: boom/)).toBeTruthy();
  });

  it("collapses and expands a composite on click", () => {
    render(<JsonView node={serialize({ a: 1 })} label="value" />);
    const summary = screen.getByText(/1 key/);
    const toggle = summary.closest(".sgdt-json-toggle")!;
    fireEvent.click(toggle); // collapse
    fireEvent.click(toggle); // expand
    expect(screen.getByText(/1 key/)).toBeTruthy();
  });

  it("marks circular references", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic["self"] = cyclic;
    render(<JsonView node={serialize(cyclic)} />);
    expect(screen.getByText("[Circular]")).toBeTruthy();
  });

  it("marks max-depth and renders empty composites", () => {
    const { rerender } = render(<JsonView node={serialize({ a: { b: 1 } }, { maxDepth: 1 })} />);
    expect(screen.getByText("…")).toBeTruthy();

    rerender(<JsonView node={serialize({})} />);
    expect(screen.getByText(/0 keys/)).toBeTruthy();
  });

  it("shows a truncation count on capped composites", () => {
    const { rerender } = render(<JsonView node={serialize([1, 2, 3], { maxEntries: 2 })} />);
    expect(screen.getByText(/Array\(2\) \+1/)).toBeTruthy();

    rerender(<JsonView node={serialize({ a: 1, b: 2, c: 3 }, { maxEntries: 2 })} />);
    expect(screen.getByText(/\+1/)).toBeTruthy();
  });
});
