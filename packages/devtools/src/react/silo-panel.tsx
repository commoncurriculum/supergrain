// The silo inspector: tabs (with live counts), a filter box, and a master/detail
// view over a store's cached documents and query results.
//
// `SiloPanelContent` and `SiloStatusDot` are wrapped in `tracked()` so reading
// the store's reactive state during render subscribes them to it — counts, the
// list, and the open detail all update live as fetches settle and documents
// change, with no polling. The serialized value for the *selected* entry is read
// through the reactive proxy too, so editing that document in place updates the
// explorer.

import { tracked } from "@supergrain/kernel/react";
import { useState } from "react";
import {
  Button,
  Input,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  ToggleButton,
} from "react-aria-components";

import {
  siloActivity,
  type SiloDevtoolsBridge,
  type SiloEntrySnapshot,
  type SiloTypeSnapshot,
  snapshotSilo,
} from "../silo";
import { JsonView } from "./json-view";
import { STATUS_COLOR } from "./styles";

export type SiloTab = "documents" | "queries";

export interface SelectedEntry {
  readonly tab: SiloTab;
  readonly type: string;
  readonly key: string;
}

export interface SiloPanelContentProps {
  readonly bridge: SiloDevtoolsBridge;
  readonly tab: SiloTab;
  readonly search: string;
  readonly selected: SelectedEntry | null;
  readonly onTabChange: (tab: SiloTab) => void;
  readonly onSearchChange: (search: string) => void;
  readonly onSelect: (entry: SelectedEntry | null) => void;
}

export const SiloPanelContent = tracked(function SiloPanelContent({
  bridge,
  tab,
  search,
  selected,
  onTabChange,
  onSearchChange,
  onSelect,
}: SiloPanelContentProps) {
  // Serialize the value/error for the selected entry only — the list needs
  // scalar status alone, so a large cache stays cheap to render.
  const snapshot = snapshotSilo(bridge, {
    includeValue: (_kind, type, key) =>
      selected !== null && selected.tab === tab && selected.type === type && selected.key === key,
  });

  const docCount = snapshot.totals.documents;
  const queryCount = snapshot.totals.queries;
  const groups = tab === "documents" ? snapshot.documents : snapshot.queries;
  const needle = search.trim().toLowerCase();
  const filtered = filterGroups(groups, needle);
  const selectedEntry = findSelected(filtered, selected, tab);

  // The search box + master/detail for the active tab. Referenced from both
  // TabPanels, but react-aria only mounts the selected panel's children, so it
  // renders exactly once.
  const surface = (
    <>
      <SearchField
        className="sgdt-search"
        aria-label={`Filter ${tab}`}
        value={search}
        onChange={onSearchChange}
      >
        <Input placeholder={`Filter ${tab} by type or key…`} />
      </SearchField>
      <div className="sgdt-body">
        <div className="sgdt-list">
          {filtered.length === 0 ? (
            <div className="sgdt-empty">{needle ? "No matches." : `No cached ${tab} yet.`}</div>
          ) : (
            filtered.map((group) => (
              <TypeGroup
                key={group.type}
                group={group}
                tab={tab}
                selected={selected}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
        <div className="sgdt-detail">
          {selectedEntry ? (
            <EntryDetail entry={selectedEntry} />
          ) : (
            <div className="sgdt-empty">Select an entry to inspect it.</div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <Tabs
      className="sgdt-tabs-root"
      selectedKey={tab}
      onSelectionChange={(key) => onTabChange(key as SiloTab)}
    >
      <TabList className="sgdt-tabs" aria-label="Cache surface">
        <Tab id="documents" className="sgdt-tab">
          Documents<span className="sgdt-count">{docCount}</span>
        </Tab>
        <Tab id="queries" className="sgdt-tab">
          Queries<span className="sgdt-count">{queryCount}</span>
        </Tab>
      </TabList>
      <TabPanel id="documents" className="sgdt-tabpanel">
        {surface}
      </TabPanel>
      <TabPanel id="queries" className="sgdt-tabpanel">
        {surface}
      </TabPanel>
    </Tabs>
  );
});

/**
 * A status dot for the collapsed toggle: blue while any inspected store is
 * fetching, red if any entry is errored, green otherwise. Tracked, so it lives
 * even when the panel is closed.
 */
export const SiloStatusDot = tracked(function SiloStatusDot({
  bridges,
}: {
  bridges: ReadonlyArray<SiloDevtoolsBridge>;
}) {
  let fetching = 0;
  let errored = 0;
  for (const bridge of bridges) {
    // Cheap totals-only scan — no group/entry allocation, and subscribes the
    // (always-mounted) dot to just `isFetching` / `status` per handle.
    const activity = siloActivity(bridge);
    fetching += activity.fetching;
    errored += activity.errored;
  }
  const variant = dotVariant(fetching, errored);
  return <span className={`sgdt-toggle-dot${variant ? ` ${variant}` : ""}`} />;
});

function dotVariant(fetching: number, errored: number): string {
  if (fetching > 0) return "fetching";
  if (errored > 0) return "error";
  return "";
}

function TypeGroup({
  group,
  tab,
  selected,
  onSelect,
}: {
  group: SiloTypeSnapshot;
  tab: SiloTab;
  selected: SelectedEntry | null;
  onSelect: (entry: SelectedEntry | null) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <Button className="sgdt-group-header" aria-expanded={open} onPress={() => setOpen((v) => !v)}>
        <span className={`sgdt-caret${open ? " open" : ""}`}>▸</span>
        <span>{group.type}</span>
        <span className="sgdt-group-count">({group.entries.length})</span>
      </Button>
      {open &&
        group.entries.map((entry) => {
          const isSelected =
            selected !== null &&
            selected.tab === tab &&
            selected.type === group.type &&
            selected.key === entry.key;
          return (
            <ToggleButton
              key={entry.key}
              className="sgdt-entry"
              isSelected={isSelected}
              onPress={() => onSelect({ tab, type: group.type, key: entry.key })}
            >
              <StatusBadge entry={entry} />
              <span className="sgdt-entry-key" title={entry.key}>
                {entry.key}
              </span>
            </ToggleButton>
          );
        })}
    </div>
  );
}

function StatusBadge({ entry }: { entry: SiloEntrySnapshot }) {
  const { label, color } = badge(entry);
  return (
    <span className="sgdt-badge" style={{ background: `${color}22`, color }}>
      {label}
    </span>
  );
}

function badge(entry: SiloEntrySnapshot): { label: string; color: string } {
  if (entry.isFetching) return { label: "fetching", color: STATUS_COLOR.fetching };
  if (entry.status === "error") return { label: "error", color: STATUS_COLOR.error };
  if (entry.status === "success") return { label: "success", color: STATUS_COLOR.success };
  return { label: "pending", color: STATUS_COLOR.pending };
}

function EntryDetail({ entry }: { entry: SiloEntrySnapshot }) {
  const { label, color } = badge(entry);
  return (
    <div>
      <div className="sgdt-detail-key">{entry.key}</div>
      <div className="sgdt-meta">
        <span className="sgdt-meta-k">status</span>
        <span className="sgdt-meta-v" style={{ color }}>
          {label}
        </span>
        <span className="sgdt-meta-k">isFetching</span>
        <span className="sgdt-meta-v">{String(entry.isFetching)}</span>
        <span className="sgdt-meta-k">failureCount</span>
        <span className="sgdt-meta-v">{entry.failureCount}</span>
        <span className="sgdt-meta-k">fetchedAt</span>
        <span className="sgdt-meta-v">
          {entry.fetchedAt === null ? "—" : new Date(entry.fetchedAt).toLocaleTimeString()}
        </span>
      </div>

      {entry.value !== undefined && (
        <>
          <div className="sgdt-section-title">Value</div>
          <JsonView node={entry.value} />
        </>
      )}
      {entry.value === undefined && !entry.hasValue && (
        <div className="sgdt-empty">No value cached.</div>
      )}
      {entry.error !== undefined && (
        <>
          <div className="sgdt-section-title sgdt-json-error">Error</div>
          <JsonView node={entry.error} />
        </>
      )}
      {entry.lastError !== undefined && (
        <>
          <div className="sgdt-section-title">Last attempt error</div>
          <JsonView node={entry.lastError} />
        </>
      )}
    </div>
  );
}

function filterGroups(
  groups: ReadonlyArray<SiloTypeSnapshot>,
  needle: string,
): Array<SiloTypeSnapshot> {
  if (!needle) return [...groups];
  const result: Array<SiloTypeSnapshot> = [];
  for (const group of groups) {
    if (group.type.toLowerCase().includes(needle)) {
      result.push(group);
    } else {
      const entries = group.entries.filter((e) => e.key.toLowerCase().includes(needle));
      if (entries.length > 0) result.push({ type: group.type, entries });
    }
  }
  return result;
}

function findSelected(
  groups: ReadonlyArray<SiloTypeSnapshot>,
  selected: SelectedEntry | null,
  tab: SiloTab,
): SiloEntrySnapshot | null {
  if (selected === null || selected.tab !== tab) return null;
  for (const group of groups) {
    if (group.type === selected.type) {
      for (const entry of group.entries) {
        if (entry.key === selected.key) return entry;
      }
    }
  }
  return null;
}
