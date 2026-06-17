// <SupergrainDevtools /> — the floating panel you drop next to your app, in the
// spirit of the TanStack Query devtools: a corner toggle that opens an
// inspector over your store(s). Pass the silo `DocumentStore` you got from
// `createDocumentStore` (or from a Provider's `useDocumentStore()`); the panel
// reads its non-enumerable devtools bridge and never calls `find`, so opening it
// can't trigger fetches.
//
// Controls are react-aria-components, styled with Tailwind in the Untitled UI
// design language. Import the stylesheet once: `@supergrain/devtools/style.css`.
//
// Built to grow: the shell (toggle, framing, store selector, clear) is generic,
// and the body is one inspector among future ones (a raw kernel store, the
// profiler) that can become additional tabs.

import { type CSSProperties, useCallback, useState } from "react";
import { Button, ListBox, ListBoxItem, Popover, Select, SelectValue } from "react-aria-components";

import { getSiloDevtools, type SiloDevtoolsBridge } from "../silo";
import { type SelectedEntry, type SiloTab, SiloPanelContent, SiloStatusDot } from "./silo-panel";

export type DevtoolsPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

const FOCUS = "data-[focus-visible]:ring-2 data-[focus-visible]:ring-violet-500";
const TOGGLE = `inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 shadow-sm outline-none hover:bg-gray-50 ${FOCUS}`;
const ICON_BTN = `rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-600 outline-none hover:bg-gray-50 ${FOCUS}`;
const SELECT_TRIGGER = `sgdt-select inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700 outline-none hover:bg-gray-50 ${FOCUS}`;

export interface SupergrainDevtoolsProps {
  /** A silo `DocumentStore` to inspect. */
  store?: unknown;
  /**
   * Several named stores, shown in a selector. Keys are the labels. Use this
   * instead of `store` when an app runs more than one document store.
   */
  stores?: Readonly<Record<string, unknown>>;
  /** Open on mount. Default `false`. */
  initialIsOpen?: boolean;
  /** Corner the toggle button anchors to. Default `"bottom-right"`. */
  position?: DevtoolsPosition;
  /**
   * Render nothing. Pass `process.env.NODE_ENV === "production"` to keep the
   * panel out of production. (The store's silo-side devtools bridge is always
   * present regardless — a tiny non-enumerable hook; see `@supergrain/silo/devtools`.)
   */
  disabled?: boolean;
}

interface NamedStore {
  readonly name: string;
  readonly bridge: SiloDevtoolsBridge;
}

export function SupergrainDevtools({
  store,
  stores,
  initialIsOpen = false,
  position = "bottom-right",
  disabled = false,
}: SupergrainDevtoolsProps) {
  const [open, setOpen] = useState(initialIsOpen);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [tab, setTab] = useState<SiloTab>("documents");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedEntry | null>(null);

  // Stable callback so the memoized (tracked) panel can skip re-rendering when
  // only unrelated parent state changes.
  const onTabChange = useCallback((next: SiloTab) => {
    setTab(next);
    setSelected(null);
  }, []);

  // Resolving stores is cheap (a symbol read per store); compute it each render
  // rather than a useMemo that never hits when `stores` is an inline literal.
  // The bridge objects within are stable, so the active bridge passed down is
  // stable too.
  const named = resolveStores(store, stores);

  if (disabled || named.length === 0) return null;

  const active = named.find((s) => s.name === activeName) ?? named[0]!;
  const bridges = named.map((s) => s.bridge);

  if (!open) {
    return (
      <div
        className="sgdt-root fixed z-[99999] font-sans text-sm text-gray-700"
        style={anchor(position)}
      >
        <Button
          className={TOGGLE}
          aria-label="Open Supergrain devtools"
          onPress={() => setOpen(true)}
        >
          <SiloStatusDot bridges={bridges} />
          <span className="text-amber-500">🌾</span> Supergrain
        </Button>
      </div>
    );
  }

  return (
    <div
      className="sgdt-root fixed z-[99999] font-sans text-sm text-gray-700"
      style={anchor(position)}
    >
      <div className="flex h-[440px] max-h-[calc(100vh-2rem)] w-[720px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center gap-2.5 border-b border-gray-200 px-3 py-2.5">
          <span className="text-sm font-semibold text-gray-900">
            <span className="text-amber-500">🌾</span> Supergrain Devtools
          </span>
          {named.length > 1 && (
            <Select
              aria-label="Inspected store"
              selectedKey={active.name}
              onSelectionChange={(key) => {
                setActiveName(String(key));
                setSelected(null);
              }}
            >
              <Button className={SELECT_TRIGGER}>
                <SelectValue />
                <span aria-hidden="true" className="text-gray-400">
                  ▾
                </span>
              </Button>
              <Popover className="z-[100000] rounded-lg border border-gray-200 bg-white p-1 font-sans text-sm text-gray-700 shadow-lg">
                <ListBox className="max-h-60 overflow-auto outline-none">
                  {named.map((s) => (
                    <ListBoxItem
                      key={s.name}
                      id={s.name}
                      className="cursor-pointer rounded-md px-2.5 py-1.5 text-sm text-gray-700 outline-none data-[focused]:bg-gray-100 data-[selected]:font-semibold data-[selected]:text-violet-700"
                    >
                      {s.name}
                    </ListBoxItem>
                  ))}
                </ListBox>
              </Popover>
            </Select>
          )}
          <span className="flex-1" />
          <Button
            className={ICON_BTN}
            aria-label="Clear this store's cache"
            onPress={() => {
              active.bridge.clearMemory();
              setSelected(null);
            }}
          >
            Clear
          </Button>
          <Button className={ICON_BTN} aria-label="Close" onPress={() => setOpen(false)}>
            ✕
          </Button>
        </div>
        <SiloPanelContent
          bridge={active.bridge}
          tab={tab}
          search={search}
          selected={selected}
          onTabChange={onTabChange}
          onSearchChange={setSearch}
          onSelect={setSelected}
        />
      </div>
    </div>
  );
}

function resolveStores(
  store: unknown,
  stores: Readonly<Record<string, unknown>> | undefined,
): Array<NamedStore> {
  const named: Array<NamedStore> = [];
  const used = new Set<string>();
  // Guarantee unique names so the selector never renders duplicate keys or hides
  // a store behind a name collision (e.g. `store` plus a `stores` entry named
  // "store").
  const add = (name: string, candidate: unknown): void => {
    const bridge = getSiloDevtools(candidate);
    if (!bridge) return;
    let unique = name;
    let n = 2;
    while (used.has(unique)) unique = `${name} (${n++})`;
    used.add(unique);
    named.push({ name: unique, bridge });
  };
  if (store !== undefined) add("store", store);
  if (stores) {
    for (const name of Object.keys(stores)) add(name, stores[name]);
  }
  return named;
}

function anchor(position: DevtoolsPosition): CSSProperties {
  const gap = 16;
  const style: CSSProperties = {};
  if (position.startsWith("top")) style.top = gap;
  else style.bottom = gap;
  if (position.endsWith("right")) style.right = gap;
  else style.left = gap;
  return style;
}
