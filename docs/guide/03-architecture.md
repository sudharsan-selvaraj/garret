# 3 · Architecture

[← Getting started](02-getting-started.md) · Next: [Build a widget →](04-build-a-widget.md)

Garret is a single-tier host: one widget model, one SDK, one loading path. This is the map of how a
pack actually runs.

## Processes

```
┌ Electron main (Node) ──────────────────────────────────────────────┐
│  window / tray / HUD        clipboard        ext system (src/main/ext)│
│                              ┌───────────────────────────────────────┐│
│                              │ install · protocol (garret://) · lane  ││
│                              │ broker (capabilities) · marketplace    ││
│                              │ notifier (background) · host launch    ││
│                              └───────────────────────────────────────┘│
└──────────────▲────────────────────────────────────────▲──────────────┘
   IPC (preload/index.ts)                    utilityProcess (a pack's host)
┌──────────────┴──────────────┐               ▲  wire protocol
│ Renderer (board UI)         │               │
│  canvas · WidgetHost frame  │       ┌────────┴──────────────┐
│  Add/Settings dialogs       │       │ <webview> guest       │
│  pack loader (ext/loader)   │──────▶│ garret://<w>.<pack>/  │
└─────────────────────────────┘  wcId │ window.__garret bridge│
                                       │ (preload/extBridge.ts)│
                                       └───────────────────────┘
```

- **Main** owns everything privileged: the filesystem, secrets (AES-256-GCM), network, the
  `garret://` protocol, and the **capability broker**.
- **Renderer** is the board: it lists installed widgets, draws each one's frame (`WidgetHost`), and
  mounts each as a `<webview>`.
- **Each widget** runs in its own sandboxed `<webview>` (contextIsolation on, nodeIntegration off) on
  a **per-widget origin** `garret://<widgetId>.<packId>/`, so widgets can't read each other's storage.
- **A host** (optional) runs in an Electron `utilityProcess` — raw Node, no renderer — and talks to
  its widget over a small wire protocol.

## The extension system (`src/main/ext/`)

| Module | Job |
|--------|-----|
| `install.ts` | Unzip + verify a `.garret`, keep a signed local record, resolve enabled widgets. |
| `manifest.ts` | Parse + validate `garret.manifest.json` (the v2 schema). |
| `protocol.ts` | Serve each widget's files on its `garret://` origin, with a strict CSP + the shared `~theme.css`. |
| `lane.ts` | Guest ↔ host wiring: bind a webview, launch its host, relay commands/title. |
| `broker.ts` | **The security chokepoint.** Every `g.*` call is checked here against the widget's declared capabilities. |
| `secrets.ts` | Encrypted secret store (per-widget + per-pack `_shared`). |
| `marketplace.ts` | Fetch a registry `index.json`, compare installed versions. |
| `notifier.ts` | The shared background-notification loop (see [Build a widget §Notifications](04-build-a-widget.md#background-notifications)). |
| `theme.ts` | The generic `--gx-*` design-system CSS served to every widget. |

## How a widget loads

1. On startup the renderer calls `window.garret.ext.list()` → main returns the enabled, authentic,
   untampered widgets. `ext/loader.ts` registers each as `gx:<packId>/<widgetId>` in the plugin registry.
2. When a widget is placed, `WidgetHost` mounts a `<webview src="garret://<widgetId>.<packId>/?instance=<id>">`.
3. The guest's preload (`extBridge.ts`) **self-binds**: `invoke('ext:bind', extId, instanceId)`. Main
   verifies the sender's origin matches the claimed widget (unforgeable) and creates a **binding**
   (packId, widgetId, instanceId, capabilities, hasShared).
4. If the widget declares a `host`, main launches it (`utilityProcess`) and relays messages.
5. The guest calls `window.__garret.*`; each call hits the **broker**, which enforces capabilities.

## Capabilities (the security model)

A widget declares what it needs in its manifest; the broker enforces it. There are no consent
dialogs — capabilities are a *functional allowlist*, and the only visible risk signal is whether a
widget ships a host.

- **Free (no capability):** `storage` / `instanceStorage` — a widget's own isolated key/value store.
- **Gated:** `secrets`, `notify`, `clipboard`, `openExternal`, `embed`.
- **Network:** `network:<host>` (exact), `network:*.<suffix>` (subdomains), `network:*` (any). `g.fetch`
  is rejected for any host not covered.
- **Host-implied:** `process`, `fs`, `native`, `windows` — a host has raw Node anyway; these are markers.

A **host** is unrestricted raw Node by definition — that's what the install warning is for. Capabilities
gate the **UI** side (the `g.*` bridge), not the host.

## Powering (battery)

The board broadcasts an **active** flag (`g.active` / `useActive`): `true` when focused/HUD-up, `false`
when ambient/idle. Widgets pause animations and throttle polling when inactive (`usePoll` does this
automatically). True background work — alerting with no widget mounted — is the **notifier**, one
shared main-process loop, not a per-widget process.

Next: [Build a widget →](04-build-a-widget.md)
