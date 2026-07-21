# Garret documentation

Garret is a **macOS widget host**. It renders a layer of widgets over your wallpaper (ambient),
summons them over everything with a hotkey (HUD), and installs widgets from a marketplace. Garret
itself ships **no built-in integrations** — every widget is a **pack** you install, and each pack
owns its own data, credentials, and UI.

There is exactly **one kind of widget**: a **pack** built on the published SDK
[`@garretapp/sdk`](https://www.npmjs.com/package/@garretapp/sdk), sandboxed in its own webview and
loaded from the `garret://` scheme. No tiers, no built-ins.

## Read in order (self-onboarding)

1. **[Overview](guide/01-overview.md)** — what Garret is, the widget-host model, key terms.
2. **[Getting started](guide/02-getting-started.md)** — run the app, install a pack, place a widget.
3. **[Architecture](guide/03-architecture.md)** — how it works: processes, the extension system, capabilities.
4. **[Build a widget](guide/04-build-a-widget.md)** — the pack tutorial: manifest → UI → storage/fetch → settings → commands → notifications.
5. **[Host packs](guide/05-host-packs.md)** — when a widget needs raw Node (OAuth, local processes) and how to write one.
6. **[Publishing](guide/06-publishing.md)** — build a `.garret`, ship it to the marketplace via CI.
7. **[SDK reference](guide/07-sdk-reference.md)** — the complete `@garretapp/sdk` surface, capabilities, and manifest schema.
8. **[Pack CLI (design)](guide/08-pack-cli.md)** — the planned `garret` CLI: audit + build + pack, sharing one manifest rulebook with the app.

## Repositories

- **App** (this repo) — the Garret host: `src/main` (Electron main), `src/renderer` (board UI),
  `src/preload` (bridge), `packages/sdk` (the published `@garretapp/sdk`).
- **Packs** — [`garret-widgets`](https://github.com/sudharsan-selvaraj/garret-widgets): the first-party
  pack registry (Atlassian, Google Calendar, …) + the build/release pipeline.

## Deep dives (internals)

Feature-level design notes, useful when working on the host itself:

- [Floating surface windows](floating-surface-windows.md) — the `surfaces` API (detached windows).
- [Device-control media path](message-channel-media-path.md) — the direct MessageChannel video path.
- [Device-control plan](device-control-plan.md) / [phase F](device-control-phase-f.md) — the adb/scrcpy pack.

> Rendering tip: this is plain Markdown — it reads as a site on GitHub as-is, or point a static-site
> generator (e.g. VitePress) at `docs/` for a hosted version.
