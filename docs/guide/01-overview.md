# 1 · Overview

[← Home](../README.md) · Next: [Getting started →](02-getting-started.md)

## What Garret is

Garret is a desktop **widget host** for macOS. It gives you three ways to see the same widgets:

- **Ambient** — widgets sit on a board above your wallpaper, below your app windows.
- **HUD** — a global hotkey raises the board over everything, then dismisses it.
- **Action** — widgets can open focused, keyboard-driven panels and floating windows.

The host is deliberately empty of features. It doesn't know what Jira or Google Calendar are. It
knows how to **install, sandbox, place, and power** widgets — everything else is a pack.

## The one model: a pack

A **pack** is a distributable bundle (`.garret`, a zip) that contains one or more **widgets**. Each
widget is a small web app (usually React) that runs in its own sandboxed `<webview>` on a private
`garret://` origin, and talks to the host through a capability-checked bridge.

```
pack  (garret.atlassian)
 ├─ widget  (jira)      → a sandboxed webview
 ├─ widget  (pull-requests)
 └─ shared account (email + tokens), shared settings
```

A widget owns its own:

- **Data & credentials** — stored in its own encrypted, per-pack namespace (the host never holds them).
- **Network** — it fetches its own APIs through a brokered `fetch`, limited to hosts it declared.
- **UI** — it renders itself; the host only draws the frame (title bar, drag, opacity, colour, ⋯ menu).

There are **no tiers** (no "built-in" vs "third-party", no "web" vs "native"). The only install-time
distinction is whether a widget ships a **host** — a raw Node process for things the sandbox can't do
(OAuth loopback, spawning local binaries). A host earns a one-line "runs code on your computer"
notice at install; everything else installs silently.

## Key terms

| Term | Meaning |
|------|---------|
| **Pack** | A `.garret` bundle; the unit of install/distribution. `id` is reverse-DNS-ish, e.g. `garret.atlassian`. |
| **Widget** | One placeable thing inside a pack. Full id `packId/widgetId`; board origin `garret://widgetId.packId/`. |
| **Capability** | A declared, broker-enforced permission (`secrets`, `notify`, `network:*.atlassian.net`, …). |
| **Host** | Optional raw-Node process for a widget (`defineHost`). Warns on install. |
| **Surface** | An extra floating window a widget can open (e.g. a device mirror). |
| **Notifier** | A declarative spec that lets the host alert on new items in the background, no widget mounted. |
| **SDK** | [`@garretapp/sdk`](../guide/07-sdk-reference.md) — the one library packs are built on. |
| **Marketplace** | A `garret-widgets`-style repo with an `index.json` + `.garret` release assets. |

## What lives where

- **`src/main`** — Electron main: window/tray/HUD, the extension system (`src/main/ext/*`), clipboard.
- **`src/renderer`** — the board UI: canvas, widget frame (`WidgetHost`), Add/Settings dialogs, the pack loader (`src/renderer/src/ext/*`).
- **`src/preload`** — the context-bridge: `index.ts` (board APIs) and `extBridge.ts` (the `window.__garret` guest bridge).
- **`packages/sdk`** — the published `@garretapp/sdk` (what packs import).

Next: [Getting started →](02-getting-started.md)
