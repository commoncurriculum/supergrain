// Self-contained styling for the devtools panel. Injected once as a single
// <style> tag (keyed by id) so the package ships zero CSS files and pulls in no
// styling dependency — it drops into any app without a build step. Class names
// are prefixed `sgdt-` to avoid colliding with host-app styles.

export const STYLE_ID = "supergrain-devtools-styles";

/** Status → accent color, shared between list badges and detail. */
export const STATUS_COLOR = {
  pending: "#9aa0b4",
  success: "#3fb950",
  error: "#f85149",
  fetching: "#58a6ff",
} as const;

const CSS = `
.sgdt-root { position: fixed; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 12px; color: #e6e6ef; }
.sgdt-toggle {
  display: flex; align-items: center; gap: 6px; cursor: pointer; border: none;
  background: #16161d; color: #e6e6ef; border-radius: 999px; padding: 8px 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.4); font-weight: 600; font-size: 12px;
  border: 1px solid #2b2b38;
}
.sgdt-toggle:hover { background: #20202b; }
.sgdt-toggle-dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; }
.sgdt-toggle-dot.fetching { background: #58a6ff; animation: sgdt-pulse 1s infinite; }
.sgdt-toggle-dot.error { background: #f85149; }
@keyframes sgdt-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

.sgdt-panel {
  display: flex; flex-direction: column; width: 720px; max-width: calc(100vw - 32px);
  height: 420px; max-height: calc(100vh - 32px);
  background: #0d0d12; border: 1px solid #2b2b38; border-radius: 10px; overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.55);
}
.sgdt-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #16161d; border-bottom: 1px solid #2b2b38; }
.sgdt-title { font-weight: 700; letter-spacing: 0.2px; }
.sgdt-title .sgdt-grain { color: #d7a64b; }
.sgdt-spacer { flex: 1; }
.sgdt-iconbtn { background: transparent; border: 1px solid #2b2b38; color: #c2c2d0; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
.sgdt-iconbtn:hover { background: #20202b; color: #fff; }
.sgdt-select { background: #0d0d12; color: #e6e6ef; border: 1px solid #2b2b38; border-radius: 6px; padding: 3px 6px; font-size: 11px; }

.sgdt-tabs { display: flex; gap: 2px; padding: 6px 10px 0; background: #16161d; }
.sgdt-tab { background: transparent; border: none; color: #9aa0b4; padding: 6px 12px; cursor: pointer; border-radius: 6px 6px 0 0; font-size: 12px; font-weight: 600; }
.sgdt-tab:hover { color: #e6e6ef; }
.sgdt-tab.active { color: #fff; background: #0d0d12; }
.sgdt-tab .sgdt-count { color: #6e7187; font-weight: 500; margin-left: 5px; }

.sgdt-search { padding: 8px 10px; border-bottom: 1px solid #1d1d27; }
.sgdt-search input { width: 100%; box-sizing: border-box; background: #16161d; border: 1px solid #2b2b38; border-radius: 6px; color: #e6e6ef; padding: 5px 8px; font-size: 12px; }
.sgdt-search input::placeholder { color: #6e7187; }

.sgdt-body { display: flex; flex: 1; min-height: 0; }
.sgdt-list { width: 44%; min-width: 200px; overflow: auto; border-right: 1px solid #1d1d27; }
.sgdt-detail { flex: 1; overflow: auto; padding: 10px 12px; }

.sgdt-group-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; color: #c2c2d0; font: inherit; font-weight: 600; text-align: left; cursor: pointer; position: sticky; top: 0; background: #0d0d12; appearance: none; border: none; border-bottom: 1px solid #1d1d27; }
.sgdt-group-header:hover { background: #14141b; }
.sgdt-group-count { color: #6e7187; font-weight: 500; }
.sgdt-caret { width: 10px; display: inline-block; color: #6e7187; transition: transform 0.1s; }
.sgdt-caret.open { transform: rotate(90deg); }

.sgdt-entry { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 10px 5px 24px; cursor: pointer; color: inherit; font: inherit; text-align: left; background: transparent; appearance: none; border: none; border-bottom: 1px solid #14141b; }
.sgdt-entry:hover { background: #14141b; }
.sgdt-entry.selected { background: #1f2733; }
.sgdt-entry-key { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.sgdt-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; padding: 1px 6px; border-radius: 4px; }
.sgdt-empty { color: #6e7187; padding: 18px 14px; text-align: center; }

.sgdt-meta { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin-bottom: 12px; }
.sgdt-meta-k { color: #9aa0b4; }
.sgdt-meta-v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.sgdt-section-title { font-weight: 700; color: #c2c2d0; margin: 10px 0 4px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
.sgdt-detail-key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #fff; word-break: break-all; margin-bottom: 8px; }

.sgdt-json { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.sgdt-json-row { display: block; }
.sgdt-json-toggle { cursor: pointer; user-select: none; font: inherit; color: inherit; text-align: left; background: none; appearance: none; border: none; padding: 0; }
.sgdt-json-toggle:hover { background: #1a1a23; border-radius: 3px; }
.sgdt-json-key { color: #7ee787; }
.sgdt-json-string { color: #a5d6ff; }
.sgdt-json-number { color: #f0883e; }
.sgdt-json-boolean { color: #ff7b72; }
.sgdt-json-null { color: #8b949e; }
.sgdt-json-meta { color: #8b949e; font-style: italic; }
.sgdt-json-error { color: #f85149; }
.sgdt-indent { padding-left: 14px; border-left: 1px solid #1d1d27; margin-left: 3px; }
`;

/** Inject the stylesheet once into the document head (idempotent, SSR-safe). */
export function injectStyles(): void {
  if (typeof document === "undefined") return;
  if (document.querySelector(`#${STYLE_ID}`)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}
