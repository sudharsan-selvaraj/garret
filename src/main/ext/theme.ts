// The Garret widget design system — one stylesheet served (same-origin) to every widget at
// `garret://<id>/~theme.css`, so packs get the native macOS look for a single <link>. It is GENERIC:
// tokens + building-block classes (`gx-*`), no widget-specific styling. Consumers compose these via
// the SDK's React components (`@garretapp/sdk/react`) and add their own CSS for domain specifics.
// Keep the tokens/class names STABLE (consumers depend on them); see docs/widget-theme.md.
//
// Embedded as a string (not a file) so it's always present in the built main process with no
// asset-copy step.
export const WIDGET_THEME_CSS = `
:root {
  --gx-text: rgba(255, 255, 255, 0.92);
  --gx-text-2: rgba(235, 235, 245, 0.6);
  --gx-text-3: rgba(235, 235, 245, 0.32);
  --gx-accent: #0a84ff;
  --gx-success: #30d158;
  --gx-warning: #ff9f0a;
  --gx-danger: #ff453a;
  --gx-surface-input: rgba(118, 118, 128, 0.24);
  --gx-hover: rgba(255, 255, 255, 0.06);
  --gx-hairline: rgba(255, 255, 255, 0.1);
  --gx-r-input: 7px;
  --gx-r-group: 9px;
  --gx-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  /* Transparent by default so the Garret frame's tint/opacity shows through the whole widget. A
     widget that wants its own surface sets its own body background. */
  background: transparent;
  color: var(--gx-text);
  font-family: var(--gx-font);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.16); border-radius: 4px; }

/* utilities */
.gx-scroll { height: 100%; overflow: auto; padding: 6px; }
.gx-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gx-muted { color: var(--gx-text-2); }
.gx-caption {
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--gx-text-3); padding: 6px 8px 4px;
}

/* Item — a generic list row (leading / content / trailing). Clickable when it has onClick. */
.gx-item {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px;
  background: transparent; border: none; border-radius: 8px; color: var(--gx-text);
  text-align: left; font: inherit; cursor: default;
}
.gx-item--interactive:hover { background: var(--gx-hover); }
.gx-item-content { flex: 1; min-width: 0; }

/* Status strip — stale-while-error / refreshing hint (StatusStrip component). */
.gx-status {
  display: flex; align-items: center; gap: 6px; margin: 4px 8px 6px; padding: 5px 9px;
  border-radius: 7px; font-size: 11px; color: var(--gx-text-2); background: var(--gx-hover);
}
.gx-status--error { color: #ffb340; background: rgba(255, 159, 10, 0.12); }
.gx-status span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gx-status-retry {
  flex-shrink: 0; border: none; background: transparent; color: inherit; font-weight: 600;
  font-size: 11px; text-decoration: underline; cursor: pointer;
}
.gx-status-spin { animation: gx-spin 0.8s linear infinite; }
@keyframes gx-spin { to { transform: rotate(360deg); } }

/* Badge — a small pill; tone sets the color. */
.gx-badge {
  flex-shrink: 0; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
  letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap;
}
.gx-badge--neutral { background: rgba(142, 142, 147, 0.22); color: #c7c7cc; }
.gx-badge--accent { background: rgba(10, 132, 255, 0.2); color: #4aa8ff; }
.gx-badge--success { background: rgba(48, 209, 88, 0.2); color: #30d158; }
.gx-badge--warning { background: rgba(255, 159, 10, 0.2); color: #ffb340; }
.gx-badge--danger { background: rgba(255, 69, 58, 0.2); color: #ff6961; }

/* Dot — a small status dot; same tones. */
.gx-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--gx-text-3); }
.gx-dot--neutral { background: #8e8e93; }
.gx-dot--accent { background: var(--gx-accent); }
.gx-dot--success { background: var(--gx-success); }
.gx-dot--warning { background: var(--gx-warning); }
.gx-dot--danger { background: var(--gx-danger); }

/* Accordion — a collapsible section. */
.gx-accordion-head {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 7px 8px;
  background: transparent; border: none; border-radius: 7px; color: var(--gx-text-2);
  font: inherit; text-align: left; cursor: default;
}
.gx-accordion-head:hover { background: var(--gx-hover); }
.gx-accordion-title { flex: 1; font-size: 11.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gx-accordion-aside {
  font-size: 11px; color: var(--gx-text-3); font-variant-numeric: tabular-nums;
  background: var(--gx-surface-input); border-radius: 999px; padding: 1px 7px;
}

/* States */
/* Block flow (NOT grid/flex): the message is inline content — text + <b>/<code> — and grid/flex would
   make each inline piece a separate item stacked one-per-line. A block keeps it a normal wrapped,
   centered paragraph. */
/* Default: BLOCK flow — the message (text + <b>/<code>) flows as one wrapped, centered paragraph.
   Never grid/flex at this level or each inline piece becomes its own line. */
.gx-empty {
  height: 100%;
  display: block;
  padding: 22px 28px;
  text-align: center;
  color: var(--gx-text-2);
  font-size: 12.5px;
  line-height: 1.6;
}
/* When the message is wrapped in a single .gx-empty-msg (SDK EmptyState/ErrorState), flex-center it
   vertically too — safe because there's exactly one child, so nothing splits. Old unwrapped packs
   keep the block-flow paragraph above (top-aligned, still correct). */
.gx-empty:has(> .gx-empty-msg) { display: flex; align-items: center; justify-content: center; }
.gx-empty-msg { max-width: 42ch; }
.gx-empty b { color: var(--gx-text); font-weight: 600; }
.gx-empty code, .gx-error code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em;
  background: var(--gx-hover); padding: 1px 5px; border-radius: 4px;
}
.gx-error { color: var(--gx-danger); font-size: 12px; padding: 12px 16px; line-height: 1.5; }

/* Settings form — System-Settings style grouped rows. */
.gx-form { display: flex; flex-direction: column; gap: 16px; padding: 10px; }
.gx-form[hidden] { display: none; }
.gx-group-wrap { display: flex; flex-direction: column; gap: 6px; }
.gx-group {
  border-radius: var(--gx-r-group); background: rgba(255, 255, 255, 0.07);
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.09);
}
.gx-group-label { font-size: 12.5px; font-weight: 600; color: var(--gx-text); padding: 0 2px 2px; }
.gx-field { display: flex; align-items: center; gap: 12px; min-height: 38px; padding: 5px 12px; }
.gx-group .gx-field + .gx-field { box-shadow: inset 0 0.5px 0 var(--gx-hairline); }
.gx-field-label { flex-shrink: 0; font-size: 13px; color: var(--gx-text); }
.gx-field-control { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; }
.gx-input {
  flex: 1; min-width: 0; border: none; background: transparent; outline: none; color: var(--gx-text);
  font-size: 13px; font-family: inherit; text-align: left;
}
.gx-input::placeholder { color: var(--gx-text-3); }
.gx-select {
  appearance: none; -webkit-appearance: none; border: none; background: transparent; outline: none;
  color: var(--gx-text); font-size: 13px; font-family: inherit; text-align: right; cursor: default;
  padding-right: 18px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-opacity='0.45' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right center;
}
.gx-select option { background: #2c2c2e; color: var(--gx-text); }
.gx-switch {
  flex-shrink: 0; width: 42px; height: 25px; border: none; border-radius: 999px;
  background: var(--gx-surface-input); position: relative; cursor: default; transition: background 0.18s ease;
}
.gx-switch--on { background: var(--gx-accent); }
.gx-switch-knob {
  position: absolute; top: 2.5px; left: 2.5px; width: 20px; height: 20px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); transition: transform 0.18s ease;
}
.gx-switch--on .gx-switch-knob { transform: translateX(17px); }
.gx-form-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 2px 2px; }
.gx-form-note { font-size: 11.5px; color: var(--gx-text-2); }
.gx-btn {
  padding: 6px 16px; border: none; border-radius: var(--gx-r-input); background: var(--gx-accent);
  color: #fff; font-size: 12.5px; font-weight: 590; cursor: default;
}
.gx-btn:hover { filter: brightness(1.08); }
.gx-btn--ghost { background: transparent; color: var(--gx-text-2); }
.gx-btn--ghost:hover { background: var(--gx-hover); color: var(--gx-text); filter: none; }
`
