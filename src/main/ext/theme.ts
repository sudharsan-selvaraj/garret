// The Garret widget theme — one stylesheet served (same-origin) to every widget at
// `garret://<id>/~theme.css`, so packs get the native macOS look for a single <link>. It's the
// public CSS API for widget authors: design tokens + the component classes the first-party widgets
// use. Keep the tokens/class names STABLE (consumers depend on them); see docs/widget-theme.md.
//
// Embedded as a string (not a file) so it's always present in the built main process with no
// asset-copy step. Mirrors the relevant rules in src/renderer/src/styles.css.
export const WIDGET_THEME_CSS = `
:root {
  --text: rgba(255, 255, 255, 0.92);
  --text-2: rgba(235, 235, 245, 0.6);
  --text-3: rgba(235, 235, 245, 0.32);
  --surface-input: rgba(118, 118, 128, 0.24);
  --surface-hover: rgba(255, 255, 255, 0.06);
  --hairline: rgba(255, 255, 255, 0.1);
  --accent: #0a84ff;
  --danger: #ff453a;
  --r-input: 7px;
  --r-group: 9px;
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: #1c1c1e;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }

/* ---- header / toolbar ---- */
.g-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px 6px;
  -webkit-app-region: drag;
}
.g-bar .g-title {
  flex: 1;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.g-icon-btn {
  -webkit-app-region: no-drag;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-2);
  cursor: default;
  font-size: 14px;
}
.g-icon-btn:hover { background: var(--surface-hover); color: var(--text); }
.g-icon-btn.on { color: var(--accent); }

/* ---- ticket / issue list ---- */
.ticket-list { display: flex; flex-direction: column; padding: 6px; gap: 1px; overflow: auto; }
.list-caption {
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--text-3); padding: 6px 8px 4px;
}
.ticket {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px;
  background: transparent; border: none; border-radius: 8px; color: var(--text);
  text-align: left; font: inherit; cursor: default;
}
.ticket:hover { background: var(--surface-hover); }
.ticket-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
.ticket-dot.todo { background: #8e8e93; }
.ticket-dot.progress, .ticket-dot.open { background: var(--accent); }
.ticket-dot.done { background: #30d158; }
.ticket-dot.merged { background: #bf5af2; }
.ticket-dot.declined { background: var(--danger); }
.ticket-key {
  flex-shrink: 0; font-size: 11.5px; font-weight: 600; color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.ticket-summary {
  flex: 1; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ticket-status { flex-shrink: 0; font-size: 10.5px; color: var(--text-3); white-space: nowrap; }

/* ---- status pills ---- */
.status-pill {
  flex-shrink: 0; max-width: 40%; padding: 2px 8px; border-radius: 999px; font-size: 10px;
  font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.status-pill.todo { background: rgba(142, 142, 147, 0.22); color: #c7c7cc; }
.status-pill.progress, .status-pill.open { background: rgba(10, 132, 255, 0.2); color: #4aa8ff; }
.status-pill.done { background: rgba(48, 209, 88, 0.2); color: #30d158; }
.status-pill.merged { background: rgba(191, 90, 242, 0.22); color: #cd7bff; }
.status-pill.declined { background: rgba(255, 69, 58, 0.2); color: #ff6961; }

/* ---- grouped PR list ---- */
.pr-widget { display: flex; flex-direction: column; overflow: auto; padding: 6px; }
.pr-group-head { padding: 7px 8px; color: var(--text-2); display: flex; align-items: center; gap: 6px; }
.pr-group-name {
  flex: 1; font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
}
.pr-group-count {
  font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums;
  background: var(--surface-input); border-radius: 999px; padding: 1px 7px;
}
.pr-row { display: flex; flex-direction: column; gap: 3px; padding: 6px 8px; border-radius: 8px; }
.pr-row:hover { background: var(--surface-hover); }
.pr-row-title {
  font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.pr-meta { display: flex; align-items: center; gap: 8px; }
.pr-author {
  font-size: 11px; color: var(--text-2); white-space: nowrap; max-width: 40%; overflow: hidden;
  text-overflow: ellipsis;
}
.pr-reviewers { display: inline-flex; align-items: center; gap: 3px; }
.pr-rev-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
.pr-rev-dot.approved { background: #30d158; }
.pr-rev-dot.changes_requested { background: var(--danger); }
.pr-rev-dot.pending { background: var(--text-3); }
.pr-comments { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; color: var(--text-3); }
.pr-unmute {
  margin: 4px 6px; padding: 4px 10px; font-size: 11px; color: var(--text-3); background: transparent;
  border: none; border-radius: 6px; cursor: default;
}
.pr-unmute:hover { color: var(--text); background: var(--surface-hover); }

/* ---- settings / config form (System-Settings style grouped rows) ---- */
.settings-form { display: flex; flex-direction: column; gap: 16px; padding: 10px; }
/* Make the hidden attribute win over the flex display above (equal specificity otherwise). */
.settings-form[hidden] { display: none; }
.settings-item { display: flex; flex-direction: column; gap: 6px; }
.settings-section-label { font-size: 12.5px; font-weight: 600; color: var(--text); padding: 0 2px 2px; }
.settings-group {
  border-radius: var(--r-group); background: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.09);
}
.settings-row { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 5px 12px; }
.settings-group .settings-row + .settings-row { box-shadow: inset 0 0.5px 0 var(--hairline); }
.settings-row-label { flex-shrink: 0; font-size: 13px; color: var(--text); }
.settings-row-control { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; }
.row-input {
  flex: 1; min-width: 0; border: none; background: transparent; outline: none; color: var(--text);
  font-size: 13px; font-family: inherit; text-align: left;
}
.row-input::placeholder { color: var(--text-3); }
.row-select {
  appearance: none; -webkit-appearance: none; border: none; background: transparent; outline: none;
  color: var(--text); font-size: 13px; font-family: inherit; text-align: right; cursor: default;
  padding-right: 18px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-opacity='0.45' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right center;
}
.row-select option { background: #2c2c2e; color: var(--text); }
.switch {
  flex-shrink: 0; width: 42px; height: 25px; border: none; border-radius: 999px;
  background: var(--surface-input); position: relative; cursor: default; transition: background 0.18s ease;
}
.switch.on { background: var(--accent); }
.switch-knob {
  position: absolute; top: 2.5px; left: 2.5px; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); transition: transform 0.18s ease;
}
.switch.on .switch-knob { transform: translateX(17px); }
.settings-note { font-size: 11.5px; color: var(--text-2); line-height: 1.45; padding: 0 4px; }
.settings-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 2px 2px;
}
.settings-saved { font-size: 11.5px; color: var(--text-2); }
.settings-done {
  padding: 6px 16px; border: none; border-radius: var(--r-input); background: var(--accent);
  color: #fff; font-size: 12.5px; font-weight: 590; cursor: default;
}
.settings-done:hover { filter: brightness(1.08); }

/* ---- empty / error states ---- */
.svc-empty {
  height: 100%; display: grid; place-items: center; padding: 18px; text-align: center;
  color: var(--text-2); font-size: 12.5px; line-height: 1.5;
}
.svc-empty b { color: var(--text); font-weight: 600; }
.svc-error { color: var(--danger); font-size: 12px; padding: 12px 16px; line-height: 1.5; }
`
