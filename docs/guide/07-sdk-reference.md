# 7 · SDK reference

[← Publishing](06-publishing.md) · [Home](../README.md)

Everything a pack imports lives in **`@garretapp/sdk`**. Entry points:

| Import | Contents |
|--------|----------|
| `@garretapp/sdk` | Shared types (`GarretResponse`, `SharedApi`, `WidgetCommand`, …). |
| `@garretapp/sdk/react` | Hooks + UI components (the main import for UI code). |
| `@garretapp/sdk/host` | `defineHost`, `HostContext` (host code only). |
| `@garretapp/sdk/ui` | Low-level UI client (rarely needed directly). |

## Manifest schema (`garret.manifest.json`)

```jsonc
{
  "apiVersion": 2,                       // required, current format
  "id": "publisher.pack",                // unique pack id (reverse-DNS-ish)
  "publisher": "publisher",
  "name": "Display Name",
  "version": "1.0.0",                    // bump to trigger updates
  "description": "One line.",
  "shared": {                            // optional: one namespace for all the pack's widgets
    "settings": { "schema": [ /* SettingsField[] */ ] }
  },
  "widgets": [
    {
      "id": "widget",                    // unique within the pack
      "name": "Widget Name",
      "ui": "dist/widget",               // dir with index.html + app.js
      "host": "dist/host/index.cjs",     // optional Node host → install warning
      "capabilities": ["secrets", "network:*.example.com"],
      "defaultSize": { "w": 5, "h": 7 }, // grid units
      "minSize": { "w": 3, "h": 3 },
      "settings": { "schema": [ /* SettingsField[] */ ] },   // per-placement config
      "surfaces": { /* surfaceId → SurfaceSpec */ },         // floating windows
      "notifier": { /* NotifierSpec */ }                     // background notifications
    }
  ]
}
```

**SettingsField** = `{ key, label, type, options?, default?, placeholder? }`, `type` ∈
`'string' | 'secret' | 'number' | 'boolean' | 'select'` (`secret` → encrypted, write-only in the UI).

**NotifierSpec** = `{ auth?, request, itemsPath?, idField, titleTemplate, bodyTemplate?, urlTemplate?, intervalMin? }`
— see [Build a widget §Background notifications](04-build-a-widget.md#background-notifications).

## Capabilities

Declared per widget; enforced by the broker on every `g.*` call.

| Capability | Unlocks |
|------------|---------|
| *(none)* | `g.storage`, `g.instanceStorage`, `g.shared.storage` — key/value stores are free |
| `secrets` | `g.secrets`, `g.shared.secrets` (encrypted) |
| `notify` | `g.notify(...)` |
| `openExternal` | `g.openExternal(url)` + notification click-through |
| `clipboard` | `g.clipboard.readText/writeText` |
| `embed` | render an isolated `<webview>` onto an arbitrary https page |
| `network:<host>` | `g.fetch` to exactly `<host>` |
| `network:*.<suffix>` | `g.fetch` to any subdomain of `<suffix>` |
| `network:*` | `g.fetch` to any host |
| `process` / `fs` / `native` / `windows` | markers for a widget that ships a host (raw Node has these anyway) |

## `useGarret()` → the platform (`g`)

| Member | Notes |
|--------|-------|
| `storage` / `instanceStorage` | `get<T>(k)` / `set(k,v)` / `delete(k)` / `keys()`. Per-widget vs per-placement. |
| `secrets` | `get(k)` / `set(k,v)` / `delete(k)`. Encrypted. Needs `secrets`. |
| `shared` | `{ storage, secrets }` — the pack-shared namespace (needs `shared` in manifest). |
| `fetch(url, init?)` | → `GarretResponse` (`.ok`, `.status`, `.text()`, `.json<T>()`, `.arrayBuffer()`). Gated by `network:*`. |
| `notify(title, body?, { url? })` | System notification; `url` makes it click-through (needs `openExternal`). |
| `openExternal(url)` | Open an https URL in the browser. |
| `clipboard` | `readText()` / `writeText(v)`. |
| `active` / `onActiveChange(cb)` | Board active/idle — pause work when idle. |
| `setCommands([{id,label}])` / `onCommand(cb)` | The frame ⋯-menu bus (prefer `useWidgetMenu`). |
| `setTitle(title)` | Override the frame title. |
| `surfaces.open(id, { key, title, props })` | Open a declared floating surface. |
| `onReady(cb)` | Fires when the widget binds (prefer `useInstanceConfig`'s `loaded`). |

## Hooks (`@garretapp/sdk/react`)

| Hook | Use |
|------|-----|
| `useGarret()` | The `g` platform above. |
| `useInstanceConfig(defaults)` | `{ cfg, set, loaded }` — per-placement config; **gate first fetch on `loaded`**. |
| `usePoll(fn, { intervalMs, deps?, enabled?, background?, idleFloorMs? })` | Declarative polling → `{ data, error, loading, refresh }`. Active-gated; `background:true` keeps polling when idle (throttled). |
| `useWidgetMenu([{ id, label, run }])` | Declare + handle frame ⋯-menu commands. |
| `useActive()` | The board active flag. |
| `useHost<Api,Events>()` | Typed proxy of a pack's host methods. |
| `useHostEvent<Events,K>(channel, cb)` | Subscribe to host events. |
| `useStream(factory, deps, opts?)` | Consume a host stream. |
| `useConfig()` / `useProps()` | Low-level config / surface launch-props. |

## Components (`@garretapp/sdk/react`)

Generic, theme-styled building blocks (no widget-specific UI) — compose them into your own layout.

- **States:** `EmptyState`, `ErrorState`, `StatusStrip` (stale-while-error / refreshing).
- **Layout:** `Scroll`, `Item` (leading/content/trailing row), `Accordion`.
- **Feedback:** `Badge`, `Dot` (both take a `tone`: neutral/accent/success/warning/danger).
- **Settings:** `SettingsPanel`, `FieldGroup`, `Field`, `TextInput`, `NumberInput`, `Select`, `Switch`,
  and `AutoForm` (renders a form from a `FieldSpec[]` schema).

All emit `--gx-*` classes styled by the shared `~theme.css` served on the widget's origin — so widgets
look native without shipping a design system.

## Host runtime (`@garretapp/sdk/host`)

`defineHost<Api, Events>((ctx) => methods)` — `ctx` provides:

| `ctx.*` | |
|---------|--|
| `storage` / `secrets` / `shared` | Same stores as the UI, host-side. |
| `fetch` | Node fetch (unrestricted — the host isn't sandboxed). |
| `emit(channel, payload)` | Push an event to the UI (`useHostEvent`). |
| `stream(fn)` | Return a stream of chunks (`useStream`). |
| `spawn` / `spawnShell` / `resolveBinary` | Run local processes / find binaries. |
| `onDispose(cb)` | Cleanup when the widget unmounts. |
| `log(...)` | Host logging. |

[← Publishing](06-publishing.md) · [Home](../README.md)
