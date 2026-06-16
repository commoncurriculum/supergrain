// <SupergrainDevtools /> — the floating panel you drop next to your app, in the
// spirit of the TanStack Query devtools: a corner toggle that opens an
// inspector over your store(s). Pass the silo `DocumentStore` you got from
// `createDocumentStore` (or from a Provider's `useDocumentStore()`); the panel
// reads its non-enumerable devtools bridge and never calls `find`, so opening it
// can't trigger fetches.
//
// Built to grow: the shell (toggle, framing, store selector, clear) is generic,
// and the body is one inspector among future ones (a raw kernel store, the
// profiler) that can become additional tabs.

import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { getSiloDevtools, type SiloDevtoolsBridge } from "../silo";
import { type SelectedEntry, type SiloTab, SiloPanelContent, SiloStatusDot } from "./silo-panel";
import { injectStyles } from "./styles";

export type DevtoolsPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface SupergrainDevtoolsProps {
  /** A silo `DocumentStore` (or its devtools bridge) to inspect. */
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
   * Render nothing at all. Pass `process.env.NODE_ENV === "production"` to keep
   * the devtools out of production bundles' runtime entirely.
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
  useEffect(() => {
    if (!disabled) injectStyles();
  }, [disabled]);

  const named = useMemo(() => resolveStores(store, stores), [store, stores]);

  const [open, setOpen] = useState(initialIsOpen);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [tab, setTab] = useState<SiloTab>("documents");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SelectedEntry | null>(null);

  if (disabled || named.length === 0) return null;

  const active = named.find((s) => s.name === activeName) ?? named[0]!;
  const bridges = named.map((s) => s.bridge);

  if (!open) {
    return (
      <div className="sgdt-root" style={anchor(position)}>
        <button
          className="sgdt-toggle"
          onClick={() => setOpen(true)}
          title="Open Supergrain devtools"
        >
          <SiloStatusDot bridges={bridges} />
          <span className="sgdt-grain">🌾</span> Supergrain
        </button>
      </div>
    );
  }

  return (
    <div className="sgdt-root" style={anchor(position)}>
      <div className="sgdt-panel">
        <div className="sgdt-header">
          <span className="sgdt-title">
            <span className="sgdt-grain">🌾</span> Supergrain Devtools
          </span>
          {named.length > 1 && (
            <select
              className="sgdt-select"
              value={active.name}
              onChange={(e) => {
                setActiveName(e.target.value);
                setSelected(null);
              }}
            >
              {named.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <span className="sgdt-spacer" />
          <button
            className="sgdt-iconbtn"
            title="Clear this store's cache"
            onClick={() => {
              active.bridge.clearMemory();
              setSelected(null);
            }}
          >
            Clear
          </button>
          <button className="sgdt-iconbtn" title="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <SiloPanelContent
          bridge={active.bridge}
          tab={tab}
          search={search}
          selected={selected}
          onTabChange={(next) => {
            setTab(next);
            setSelected(null);
          }}
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
  if (store !== undefined) {
    const bridge = getSiloDevtools(store);
    if (bridge) named.push({ name: "store", bridge });
  }
  if (stores) {
    for (const name of Object.keys(stores)) {
      const bridge = getSiloDevtools(stores[name]);
      if (bridge) named.push({ name, bridge });
    }
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
