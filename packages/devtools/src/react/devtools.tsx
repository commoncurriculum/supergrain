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

import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { getSiloDevtools, type SiloDevtoolsBridge } from "../silo";
import { type SelectedEntry, type SiloTab, SiloPanelContent, SiloStatusDot } from "./silo-panel";
import { injectStyles } from "./styles";

export type DevtoolsPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

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
   * Render nothing and skip injecting styles. Pass
   * `process.env.NODE_ENV === "production"` to keep the panel out of production.
   * (The store's silo-side devtools bridge is always present regardless — it's a
   * tiny non-enumerable hook, like the Redux devtools global; see
   * `@supergrain/silo/devtools`.)
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
