import { SupergrainDevtools } from "@supergrain/devtools/react";
import { createReactive } from "@supergrain/kernel";
import { createDocumentStore, type DocumentStore } from "@supergrain/silo";
import { SILO_DEVTOOLS } from "@supergrain/silo/devtools";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());

type Models = {
  user: { id: string; name: string };
};
type Queries = {
  search: { params: { q: string }; result: { ids: Array<string> } };
};

function makeStore(): DocumentStore<Models> {
  return createDocumentStore<Models>({
    models: { user: { adapter: { find: () => Promise.resolve([]) } } },
  });
}

function makeStoreWithQuery(): DocumentStore<Models, Queries> {
  return createDocumentStore<Models, Queries>({
    models: { user: { adapter: { find: () => Promise.resolve([]) } } },
    queries: { search: { adapter: { find: () => Promise.resolve([]) } } },
  });
}

// Build a fake store carrying a hand-crafted devtools bridge so handle states
// (fetching, errored) can be rendered deterministically without real fetches.
function handle(over: Record<string, unknown>): Record<string, unknown> {
  return {
    status: "pending",
    isFetching: false,
    value: undefined,
    error: undefined,
    fetchedAt: undefined,
    failureCount: 0,
    lastError: undefined,
    ...over,
  };
}

function syntheticStore(docs: Record<string, Array<[string, Record<string, unknown>]>>): object {
  const documents = new Map(
    Object.entries(docs).map(([type, entries]) => [type, new Map(entries)] as const),
  );
  const state = createReactive({ documents, queries: new Map() });
  const bridge = {
    state,
    documentTypes: Object.keys(docs),
    queryTypes: [],
    clearMemory: () => {},
  };
  const store = {};
  Object.defineProperty(store, SILO_DEVTOOLS, { value: bridge, enumerable: false });
  return store;
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
    fireEvent.click(screen.getByRole("button", { name: "Open Supergrain devtools" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Clear this store's cache" }));
    });

    // The entry remains listed (handle persists) but resets to pending, and the
    // detail selection is cleared.
    expect(screen.getByText("Select an entry to inspect it.")).toBeTruthy();
  });

  it("closes the panel", () => {
    render(<SupergrainDevtools store={makeStore()} initialIsOpen />);
    expect(screen.getByText("Supergrain Devtools")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Supergrain Devtools")).toBeNull();
  });

  it("anchors to the configured corner", () => {
    const { container } = render(<SupergrainDevtools store={makeStore()} position="top-left" />);
    const root = container.querySelector(".sgdt-root") as HTMLElement;
    expect(root.style.top).toBe("16px");
    expect(root.style.left).toBe("16px");
  });

  it("switches tabs, filters, and toggles a group", async () => {
    const store = makeStoreWithQuery();
    render(<SupergrainDevtools store={store} initialIsOpen />);

    await act(async () => {
      store.insertDocument("user", { id: "u1", name: "Ada" });
      store.insertQueryResult("search", { q: "ada" }, { ids: ["u1"] });
    });

    expect(screen.getByText("user")).toBeTruthy();

    const filter = screen.getByPlaceholderText(/Filter documents/);
    // Match by key, by type name, then no match.
    fireEvent.change(filter, { target: { value: "u1" } });
    expect(screen.getByText("u1")).toBeTruthy();
    fireEvent.change(filter, { target: { value: "user" } });
    expect(screen.getByText("user")).toBeTruthy();
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(screen.getByText("No matches.")).toBeTruthy();
    fireEvent.change(filter, { target: { value: "" } });

    // Collapse the type group.
    fireEvent.click(screen.getByText("user"));

    // Switch to the Queries tab.
    fireEvent.click(screen.getByText(/Queries/));
    expect(screen.getByText("search")).toBeTruthy();
  });

  it("shows configured-but-empty type groups instead of an empty state", () => {
    render(<SupergrainDevtools store={makeStore()} initialIsOpen />);
    // The configured `user` type renders its header even with zero entries.
    expect(screen.getByText("user")).toBeTruthy();
    expect(screen.queryByText("No cached documents yet.")).toBeNull();
  });

  it("shows the empty state for a tab with no configured types", () => {
    // makeStore configures no queries, so the Queries tab has nothing at all.
    render(<SupergrainDevtools store={makeStore()} initialIsOpen />);
    fireEvent.click(screen.getByText(/Queries/));
    expect(screen.getByText("No cached queries yet.")).toBeTruthy();
  });

  it("disambiguates a stores key colliding with the single store", async () => {
    const { container } = render(
      <SupergrainDevtools store={makeStore()} stores={{ store: makeStore() }} initialIsOpen />,
    );
    // Open the react-aria Select via its trigger.
    fireEvent.click(container.querySelector(".sgdt-select")!);
    const labels = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(labels).toContain("store");
    expect(labels).toContain("store (2)");
  });

  it("renders interactive controls as keyboard-accessible buttons", async () => {
    const store = makeStore();
    render(<SupergrainDevtools store={store} initialIsOpen />);
    await act(async () => {
      store.insertDocument("user", { id: "k1", name: "Ada" });
    });

    const header = screen.getByText("user").closest("button");
    expect(header?.getAttribute("aria-expanded")).toBe("true");

    const entry = screen.getByText("k1").closest("button");
    expect(entry).toBeTruthy();
    fireEvent.click(screen.getByText("k1"));
    expect(entry?.getAttribute("aria-pressed")).toBe("true");
  });

  it("supports multiple named stores via a selector", async () => {
    const { container } = render(
      <SupergrainDevtools
        stores={{ app: makeStore(), junk: {}, admin: makeStore() }}
        initialIsOpen
      />,
    );
    // Defaults to the first valid store ("app"); open the selector and switch.
    fireEvent.click(container.querySelector(".sgdt-select")!);
    fireEvent.click(await screen.findByRole("option", { name: "admin" }));
    expect(container.querySelector(".sgdt-select")!.textContent).toContain("admin");
  });

  it("shows a fetching dot on the collapsed toggle", () => {
    const { container } = render(
      <SupergrainDevtools
        store={syntheticStore({ user: [["busy", handle({ isFetching: true })]] })}
      />,
    );
    expect(container.querySelector(".sgdt-toggle-dot.fetching")).toBeTruthy();
  });

  it("shows an error dot on the collapsed toggle", () => {
    const { container } = render(
      <SupergrainDevtools
        store={syntheticStore({
          user: [["bad", handle({ status: "error", error: new Error("x") })]],
        })}
      />,
    );
    expect(container.querySelector(".sgdt-toggle-dot.error")).toBeTruthy();
  });

  it("renders each status, detail sections, and selection across types and tabs", () => {
    const store = syntheticStore({
      user: [
        [
          "ok",
          handle({ status: "success", value: { id: "ok", name: "Ada" }, fetchedAt: new Date(0) }),
        ],
        ["busy", handle({ isFetching: true })],
        [
          "bad",
          handle({
            status: "error",
            error: new Error("boom"),
            lastError: new Error("again"),
            failureCount: 2,
          }),
        ],
        ["idle", handle({})],
      ],
      post: [["p1", handle({ status: "success", value: { id: "p1" } })]],
    });
    render(<SupergrainDevtools store={store} initialIsOpen />);

    // Status badges for the varied handles.
    expect(screen.getByText("fetching")).toBeTruthy();
    expect(screen.getAllByText("success").length).toBeGreaterThan(0);

    // Errored entry: both error and last-attempt-error sections.
    fireEvent.click(screen.getByText("bad"));
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("Last attempt error")).toBeTruthy();

    // Successful entry: value explorer (also a cross-type selection: the `post`
    // group is now compared against a `user` selection).
    fireEvent.click(screen.getByText("ok"));
    expect(screen.getByText("name:")).toBeTruthy();

    // Idle entry: no cached value.
    fireEvent.click(screen.getByText("idle"));
    expect(screen.getByText("No value cached.")).toBeTruthy();

    // Filter the selected entry out of view → the selection is no longer found.
    fireEvent.change(screen.getByPlaceholderText(/Filter documents/), {
      target: { value: "busy" },
    });
    expect(screen.getByText("Select an entry to inspect it.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Filter documents/), { target: { value: "" } });

    // With a documents selection, switch tabs and back (selected.tab vs active).
    fireEvent.click(screen.getByText(/Queries/));
    fireEvent.click(screen.getByText(/Documents/));
    expect(screen.getByText("user")).toBeTruthy();
  });
});
