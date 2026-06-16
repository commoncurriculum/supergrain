import { SupergrainDevtools } from "@supergrain/devtools/react";
import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

type Models = {
  user: { id: string; name: string };
};

function makeStore(): DocumentStore<Models> {
  return createDocumentStore<Models>({
    models: { user: { adapter: { find: () => Promise.resolve([]) } } },
  });
}

describe("<SupergrainDevtools />", () => {
  it("renders nothing when disabled", () => {
    const store = makeStore();
    const { container } = render(<SupergrainDevtools store={store} disabled initialIsOpen />);
    expect(container.querySelector(".sgdt-root")).toBeNull();
  });

  it("renders nothing for a value that isn't a silo store", () => {
    const { container } = render(<SupergrainDevtools store={{}} initialIsOpen />);
    expect(container.querySelector(".sgdt-root")).toBeNull();
  });

  it("toggles open from the collapsed button", () => {
    const store = makeStore();
    render(<SupergrainDevtools store={store} />);
    expect(screen.queryByText("Supergrain Devtools")).toBeNull();
    fireEvent.click(screen.getByTitle("Open Supergrain devtools"));
    expect(screen.getByText("Supergrain Devtools")).toBeTruthy();
  });

  it("lists inserted documents and shows the value on selection", async () => {
    const store = makeStore();
    render(<SupergrainDevtools store={store} initialIsOpen />);

    await act(async () => {
      store.insertDocument("user", { id: "user-7", name: "Ada" });
    });

    // Type group + entry key both render.
    expect(screen.getByText("user")).toBeTruthy();
    const entry = screen.getByText("user-7");
    fireEvent.click(entry);

    // Detail explorer surfaces the document field's value.
    expect(screen.getByText("name:")).toBeTruthy();
    expect(screen.getByText('"Ada"')).toBeTruthy();
  });

  it("updates live as the store changes", async () => {
    const store = makeStore();
    render(<SupergrainDevtools store={store} initialIsOpen />);

    await act(async () => {
      store.insertDocument("user", { id: "alpha", name: "A" });
    });
    expect(screen.getByText("alpha")).toBeTruthy();

    await act(async () => {
      store.insertDocument("user", { id: "beta", name: "B" });
    });
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("clears the cache from the panel", async () => {
    const store = makeStore();
    render(<SupergrainDevtools store={store} initialIsOpen />);

    await act(async () => {
      store.insertDocument("user", { id: "gone", name: "X" });
    });
    fireEvent.click(screen.getByText("gone"));
    expect(screen.getByText('"X"')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Clear this store's cache"));
    });

    // The entry remains listed (handle persists) but resets to pending, and the
    // detail selection is cleared.
    expect(screen.getByText("Select an entry to inspect it.")).toBeTruthy();
  });
});
