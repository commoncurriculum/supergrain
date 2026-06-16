// React bindings for @supergrain/devtools.
//
// Drop <SupergrainDevtools store={store} /> next to your app (alongside the
// silo Provider) to get a floating inspector for the store's cache.

export {
  type DevtoolsPosition,
  SupergrainDevtools,
  type SupergrainDevtoolsProps,
} from "./devtools";

// Lower-level building blocks, for embedding the inspector in a custom shell.
export {
  type SelectedEntry,
  type SiloPanelContentProps,
  SiloPanelContent,
  SiloStatusDot,
  type SiloTab,
} from "./silo-panel";
export { JsonView } from "./json-view";
export { injectStyles, STATUS_COLOR, STYLE_ID } from "./styles";
