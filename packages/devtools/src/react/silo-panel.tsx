// The silo inspector: tabs (with live counts), a filter box, and a master/detail
// view over a store's cached documents and query results. Controls are
// react-aria-components styled with Tailwind in the Untitled UI design language.
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

const FOCUS = "data-[focus-visible]:ring-2 data-[focus-visible]:ring-violet-500";
const TAB = `cursor-pointer rounded-t-md px-3 py-1.5 text-sm font-medium text-gray-500 outline-none hover:text-gray-700 data-[selected]:bg-white data-[selected]:text-violet-700 data-[selected]:shadow-[inset_0_-2px_0_0_#7c3aed] ${FOCUS}`;
const GROUP_HEADER = `sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-left text-sm font-semibold text-gray-600 outline-none hover:bg-gray-100 ${FOCUS}`;
const ENTRY = `flex w-full items-center gap-2 border-b border-gray-50 py-1.5 pr-3 pl-6 text-left outline-none hover:bg-gray-50 data-[selected]:bg-violet-50 ${FOCUS}`;
const EMPTY = "p-5 text-center text-sm text-gray-400";
const BADGE = "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

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
        className="border-b border-gray-200 px-3 py-2"
        aria-label={`Filter ${tab}`}
        value={search}
        onChange={onSearchChange}
      >
        <Input
          className="w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30"
          placeholder={`Filter ${tab} by type or key…`}
        />
      </SearchField>
      <div className="flex min-h-0 flex-1">
        <div className="w-[44%] min-w-[200px] overflow-auto border-r border-gray-200">
          {filtered.length === 0 ? (
            <div className={EMPTY}>{needle ? "No matches." : `No cached ${tab} yet.`}</div>
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
        <div className="flex-1 overflow-auto p-3">
          {selectedEntry ? (
            <EntryDetail entry={selectedEntry} />
          ) : (
            <div className={EMPTY}>Select an entry to inspect it.</div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      selectedKey={tab}
      onSelectionChange={(key) => onTabChange(key as SiloTab)}
    >
      <TabList
        className="flex gap-1 border-b border-gray-200 bg-gray-50 px-3 pt-2"
        aria-label="Cache surface"
      >
        <Tab id="documents" className={TAB}>
          Documents<span className="ml-1.5 font-normal text-gray-400">{docCount}</span>
        </Tab>
        <Tab id="queries" className={TAB}>
          Queries<span className="ml-1.5 font-normal text-gray-400">{queryCount}</span>
        </Tab>
      </TabList>
      <TabPanel id="documents" className="flex min-h-0 flex-1 flex-col outline-none">
        {surface}
      </TabPanel>
      <TabPanel id="queries" className="flex min-h-0 flex-1 flex-col outline-none">
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
  return (
    <span
      data-variant={dotVariant(fetching, errored)}
      className="inline-block size-2 rounded-full bg-emerald-500 data-[variant=error]:bg-red-500 data-[variant=fetching]:animate-pulse data-[variant=fetching]:bg-blue-500"
    />
  );
});

function dotVariant(fetching: number, errored: number): string {
  if (fetching > 0) return "fetching";
  if (errored > 0) return "error";
  return "ok";
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
      <Button className={GROUP_HEADER} aria-expanded={open} onPress={() => setOpen((v) => !v)}>
        <span
          className={`inline-block w-2.5 text-gray-400 transition-transform${open ? " rotate-90" : ""}`}
        >
          ▸
        </span>
        <span>{group.type}</span>
        <span className="font-normal text-gray-400">({group.entries.length})</span>
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
              className={ENTRY}
              isSelected={isSelected}
              onPress={() => onSelect({ tab, type: group.type, key: entry.key })}
            >
              <StatusBadge entry={entry} />
              <span className="flex-1 truncate font-mono text-xs text-gray-700" title={entry.key}>
                {entry.key}
              </span>
            </ToggleButton>
          );
        })}
    </div>
  );
}

function StatusBadge({ entry }: { entry: SiloEntrySnapshot }) {
  const tone = badge(entry);
  return <span className={`${BADGE} ${tone.badge}`}>{tone.label}</span>;
}

interface Tone {
  label: string;
  badge: string;
  text: string;
}

function badge(entry: SiloEntrySnapshot): Tone {
  if (entry.isFetching)
    return { label: "fetching", badge: "bg-blue-50 text-blue-700", text: "text-blue-700" };
  if (entry.status === "error")
    return { label: "error", badge: "bg-red-50 text-red-700", text: "text-red-700" };
  if (entry.status === "success") {
    return { label: "success", badge: "bg-emerald-50 text-emerald-700", text: "text-emerald-700" };
  }
  return { label: "pending", badge: "bg-gray-100 text-gray-500", text: "text-gray-500" };
}

function EntryDetail({ entry }: { entry: SiloEntrySnapshot }) {
  const tone = badge(entry);
  return (
    <div>
      <div className="mb-2 break-all font-mono text-sm font-semibold text-gray-900">
        {entry.key}
      </div>
      <div className="mb-3 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1">
        <span className="text-gray-500">status</span>
        <span className={`font-mono text-xs ${tone.text}`}>{tone.label}</span>
        <span className="text-gray-500">isFetching</span>
        <span className="font-mono text-xs text-gray-700">{String(entry.isFetching)}</span>
        <span className="text-gray-500">failureCount</span>
        <span className="font-mono text-xs text-gray-700">{entry.failureCount}</span>
        <span className="text-gray-500">fetchedAt</span>
        <span className="font-mono text-xs text-gray-700">
          {entry.fetchedAt === null ? "—" : new Date(entry.fetchedAt).toLocaleTimeString()}
        </span>
      </div>

      {entry.value !== undefined && (
        <>
          <div className="mt-2.5 mb-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            Value
          </div>
          <JsonView node={entry.value} />
        </>
      )}
      {entry.value === undefined && !entry.hasValue && (
        <div className={EMPTY}>No value cached.</div>
      )}
      {entry.error !== undefined && (
        <>
          <div className="mt-2.5 mb-1 text-[10px] font-bold tracking-wider text-red-600 uppercase">
            Error
          </div>
          <JsonView node={entry.error} />
        </>
      )}
      {entry.lastError !== undefined && (
        <>
          <div className="mt-2.5 mb-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            Last attempt error
          </div>
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
