# Building a Garret widget

A third‑party Garret widget is a small web bundle that runs **sandboxed** — in an isolated,
out‑of‑process `<webview>` on a private origin, with no Node, no remote scripts, and no
access to anything you didn't declare. You write a React component; the host injects an
`sdk` that brokers every privileged action (HTTP, backend services, storage) and enforces
the permissions the user approved at install.

This guide takes you from zero to an installed widget. The full enforcement details live in
[`sandbox-design.md`](./sandbox-design.md) and the API contract in
[`external-widget-contract.md`](./external-widget-contract.md).

---

## 1. Prerequisites

- Node 18+ and npm.
- A bundler that emits a single self‑contained script. Examples here use **esbuild**.
- The SDK packages (published on npm):

```bash
npm i garret-widget-sdk          # the package you build against
npm i react react-dom            # peer deps (React 18+)
npm i -D esbuild typescript      # build tooling
```

`garret-widget-sdk` re‑exports everything from `garret-core`, so it's the only Garret
package you import from.

---

## 2. A widget is three files

The host installs a **folder** (later, a packaged archive). After bundling, the installable
folder contains exactly:

```
my-widget/
├── manifest.json     # identity, size, declared permissions, config schema
├── index.html        # loads bundle.js into #root (same-origin, no inline/remote scripts)
└── bundle.js         # your code + React, bundled into one IIFE
```

Only these file types are allowed in an install: `.html .js .mjs .css .json .map .png .jpg
.jpeg .svg .woff2`. `manifest.json` and `index.html` are **required**. Total size ≤ 20 MB,
≤ 200 files. Source files (`.tsx`, `README.md`, …) must **not** be in the installed folder —
build into a clean `dist/`.

### `manifest.json`

```json
{
  "id": "my-widget",
  "name": "My Widget",
  "version": "1.0.0",
  "description": "What it does, in one line.",
  "apiVersion": 1,
  "defaultSize": { "w": 4, "h": 4 },
  "minSize": { "w": 2, "h": 2 },
  "permissions": ["network:api.example.com", "openExternal"],
  "configSchema": {}
}
```

| Field | Notes |
|---|---|
| `id` | Lowercase `a–z 0–9 . _ -`, must start alphanumeric. The storage namespace + origin. |
| `name` | Display name. Required. |
| `version` | Shown in the manager. Falls back to `0.0.0` if omitted. |
| `apiVersion` | Host contract version you target. **Currently `1`.** The host refuses anything newer. |
| `defaultSize` / `minSize` | Placement size in grid units. |
| `permissions` | Capabilities you need (see §5). Anything not listed is denied. |
| `configSchema` | Declarative config → auto‑generated settings form + validation (see §6). |

> ⚠️ The on‑disk `manifest.json` is **display‑only after install**. The authoritative
> permission ceiling is the set the user consented to, recorded by the host. Editing the
> installed manifest to grant yourself more does nothing — re‑install to change permissions.

### `index.html`

Because the sandbox serves your folder with a strict `script-src 'self'` CSP, **no inline
scripts and no CDN scripts** — everything must be in `bundle.js`:

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="margin: 0; background: transparent">
    <div id="root"></div>
    <script src="bundle.js"></script>
  </body>
</html>
```

---

## 3. Your code

`runWidget` is the entry point. It connects to the host bridge, builds the realm SDK with
your React, and mounts/refreshes your component. You never call `createSDK` yourself.

```tsx
// src/index.tsx
import * as React from 'react'
import { defineWidget, type WidgetRenderProps } from 'garret-widget-sdk'
import { runWidget } from 'garret-widget-sdk/sandbox'

function MyWidget({ config, ctx, sdk }: WidgetRenderProps): JSX.Element {
  const repo = (config.repo as string) || 'sudharsan-selvaraj/garret'
  const [stars, setStars] = React.useState<number | null>(null)

  React.useEffect(() => {
    // Host-mediated fetch — gated by your declared network: hosts. Returns PARSED data,
    // not a Response: { ok, status, data, error }.
    sdk.fetch(`https://api.github.com/repos/${repo}`).then((r) => {
      if (r.ok) setStars((r.data as { stargazers_count: number }).stargazers_count)
    })
  }, [repo, ctx.refreshToken]) // re-run when the user hits ↻

  return <div style={{ padding: 12, color: '#e6e6ea' }}>⭐ {stars ?? '…'}</div>
}

runWidget(
  defineWidget({
    apiVersion: 1,
    manifest: {
      id: 'my-widget',
      name: 'My Widget',
      defaultSize: { w: 4, h: 3 },
      permissions: ['network:api.github.com'],
      configSchema: {}
    },
    render: MyWidget
  })
)
```

`defineWidget` is just an identity helper that pins your config type — it returns the plugin
unchanged.

### `WidgetRenderProps`

| Prop | What it is |
|---|---|
| `config` | This instance's saved config (shape = your `configSchema`). |
| `ctx.instanceId` | Stable id for this placed instance. |
| `ctx.refreshToken` | Increments when the user clicks refresh — watch it in an effect. |
| `ctx.storage` | Per‑instance persistent KV (same as `sdk.storage`). |
| `ctx.updateConfig(patch)` | Persist a config patch (e.g. after an interactive step). |
| `sdk` | The capability surface (§4). |

---

## 4. The SDK surface

`sdk` (a `GarretSDK`) is the only way to reach anything privileged. Every method is async and
serializable — the host does the actual work and returns plain data; **secrets never cross
into your sandbox.**

```ts
// Hooks (auto-refreshing, cached, deduped across widgets)
sdk.usePolledQuery<T>(serviceId, method, params, { intervalMs?, refreshToken? }): PolledState<T>
sdk.useServiceStatus(serviceId): { status, refresh, setStatus }
sdk.useFileWatch(paths, opts?): number   // bumps when watched files change (needs files:read)

// Direct calls
sdk.services.query<T>(serviceId, method, params): Promise<T>   // needs service:<id>
sdk.services.status(serviceId): Promise<ServiceStatus>
sdk.fetch(url, init?): Promise<{ ok, status, data?, error? }>  // needs network:<host>
sdk.storage.get<T>(key): Promise<T | undefined>                // always available
sdk.storage.set(key, value): Promise<void>
sdk.openExternal(url): void                                    // needs openExternal; prompts user

// Pure helpers
sdk.field         // config field builders (§6)
sdk.canonicalKey  // stable key for a (serviceId, method, params) triple
```

Notes:

- **`sdk.fetch` returns parsed data, not a `Response`.** `data` is the JSON body (or text if
  it isn't JSON). It runs in the host, so there's no CORS — but the URL host must match one
  of your declared `network:` permissions, and the resolved IP is re‑checked at connect time
  (private/loopback addresses are refused, even via redirects or DNS rebinding).
- **`services.connect` / `services.disconnect` are host‑only** and always denied to a
  sandboxed widget. Connecting an account is the user's job in host UI; you only `query` a
  service the user already connected (and that you declared `service:<id>` for).
- **`storage` needs no permission** — it's automatically namespaced to your widget id, so you
  can't read another widget's data and they can't read yours.

### Polled queries (the common case)

For backend data that should refresh on a timer and survive errors, prefer `usePolledQuery`
over a raw `fetch` loop — it dedupes identical queries across widgets, caches, backs off on
errors, and wires the header refresh button:

```tsx
function PRs({ sdk, ctx }: WidgetRenderProps) {
  const { data, error, loading, refresh } = sdk.usePolledQuery<PR[]>(
    'github', 'listPRs', { state: 'open' },
    { intervalMs: 5 * 60_000, refreshToken: ctx.refreshToken }
  )
  if (loading && !data) return <div>Loading…</div>
  if (error) return <div>{error}</div>
  return <ul>{data?.map((pr) => <li key={pr.id}>{pr.title}</li>)}</ul>
}
```

---

## 5. Permissions

Declare every capability in `manifest.permissions`. The user sees them on the consent screen
at install; the sandbox enforces them at runtime. Anything you try without declaring is
**denied** and surfaced in the manager as "Tried (blocked): …" (capability disclosure).

| Permission | Grants |
|---|---|
| `network:<host>` | `sdk.fetch` to that host (and its subdomains). One entry per host. |
| `service:<id>` | `sdk.services.query` / `usePolledQuery` / `useServiceStatus` for that service. |
| `files:read` | `sdk.useFileWatch` (watch files the user points you at). |
| `openExternal` | `sdk.openExternal` — opens a URL in the user's browser, **with a confirm prompt each time**. |
| `storage` | Optional/no‑op: storage is always available regardless. |

Examples: `network:api.github.com`, `service:google`, `files:read`, `openExternal`.

What you **cannot** do, by construction: load remote scripts, use Node/Electron APIs, open
raw sockets, use WebRTC (IP‑leak protection is forced on), reach private/internal addresses,
read other widgets' storage, or connect/disconnect accounts.

### Sandbox environment (CSP)

Your document is served under a strict Content‑Security‑Policy. The practical consequences:

| CSP | What it means for your code |
|---|---|
| `script-src 'self'` | Only `bundle.js` from your folder. No inline `<script>`, no `eval`, no CDN. Bundle everything. |
| `connect-src 'none'` | The document's own `fetch` / `XMLHttpRequest` / `WebSocket` are blocked. **All network goes through `sdk.fetch`** (host‑mediated and permission‑gated). |
| `img-src 'self'` | `<img>` and CSS `background-image` may load images **bundled in your own package** (`.png/.jpg/.svg/...`). Remote image URLs and `data:` URIs are blocked — ship images in your `dist/`. |
| `style-src 'unsafe-inline'` | Inline `style={…}` and `<style>` blocks are fine — style freely. |
| `font-src 'none'` | No custom web fonts; use the system font stack (`-apple-system, …`). |

This is why the SDK exists: it's the only channel out of the sandbox, so the host can enforce
your declared permissions on every call.

---

## 6. Config & the settings form

Describe your config once in `configSchema`; the host auto‑generates a settings form and
validation from it. Use the `field` builders:

```ts
import { field } from 'garret-widget-sdk'

configSchema: {
  repo:    field.text({ label: 'Repository', placeholder: 'owner/name', required: true }),
  showAll: field.boolean({ label: 'Show closed PRs', default: false }),
  sort:    field.select({ label: 'Sort by', options: [
    { label: 'Newest', value: 'created' },
    { label: 'Updated', value: 'updated' }
  ]})
}
```

Field types: `text`, `url`, `password` (stored encrypted by the host), `number`, `boolean`,
`select`. The values land in `props.config` keyed by the schema keys.

Need custom config UI (e.g. an interactive flow)? Provide a `Settings` component on the
plugin instead — it gets `{ config, ctx, sdk, onChange }`.

---

## 7. Build

Bundle your entry into one IIFE with React inlined, then assemble the install folder:

```bash
# build.sh
set -e
mkdir -p dist
esbuild src/index.tsx --bundle --format=iife --jsx=automatic --outfile=dist/bundle.js
cp manifest.json index.html dist/
echo "built dist/ — install it via Settings → Widgets → Install widget…"
```

`--format=iife` and bundling are essential: the sandbox has no module loader and the CSP
forbids remote/inline scripts, so **everything must be in `bundle.js`**. Don't ship source or
extra files in `dist/` — the installer's allowlist will reject the folder.

### Package as a `.garret` (one shareable file)

A `.garret` is just a **zip of your `dist/` contents** (with `manifest.json` at the archive
root) — one file someone can install instead of a folder. Any zip tool works; zip the
*contents*, not the parent folder, and leave out dotfiles:

```bash
cd dist && zip -r -X ../my-widget.garret . -x '.*' -x '*/.*'
```

The host re-applies every install guard to the archive — slip-safe extraction (no `../`,
absolute, or symlink entries), the extension allowlist, and the 20 MB / 200-file caps — so a
`.garret` is exactly as trusted as a folder install (self-trust + the sandbox), not more.
Optionally add `"kind": "widget"` to your manifest; it's the default, and the slot where
multi-widget *packs* will live later.

---

## 8. Test without a host

You can render and unit‑test a widget with no Garret running, using the mock client:

```tsx
import * as React from 'react'
import { createSDK } from 'garret-widget-sdk'
import { createMockClient } from 'garret-widget-sdk/testing'

const sdk = createSDK(React, createMockClient({
  fetch: async (url) => ({ ok: true, status: 200, data: { stargazers_count: 42 } }),
  query: async (id, method) => (method === 'listPRs' ? [{ id: 1, title: 'Test PR' }] : [])
}))

// render <MyWidget config={{}} ctx={…} sdk={sdk} /> in your test renderer
```

The mock also exposes `emitPoll(update)` and `emitWatch(watchId)` to simulate live updates.

---

## 9. Install it

1. Build your `dist/` (§7), and optionally package it as a `.garret`.
2. In Garret: **Settings → Widgets**, then either **Install .garret file…** (pick your
   `.garret`) or **From folder…** (pick the `dist/` folder).
3. Review the consent screen — it lists exactly the capabilities you declared, flags an
   unverified author, and confirms the widget runs sandboxed. Confirm to install.
4. Add it to a board like any built‑in widget.

On every load the host re‑hashes your files against the install record; if they don't match
(tamper/corruption) the widget refuses to load and the manager shows "Integrity check
failed — reinstall." Shipping an update with new permissions triggers a re‑consent prompt.

---

## 10. Versioning

- `manifest.apiVersion` is the **host contract** you target — currently `1`. The host rejects
  a higher value with "needs a newer version of Garret."
- `manifest.version` is **your** widget's version, shown in the manager and used to detect
  updates (re‑install over an existing id).

---

## Reference

- SDK packages: [`garret-widget-sdk`](https://www.npmjs.com/package/garret-widget-sdk) ·
  [`garret-core`](https://www.npmjs.com/package/garret-core)
- Working example: [`examples/sandbox-selftest`](../examples/sandbox-selftest) — probes every
  capability and reports pass/blocked.
- Security model: [`sandbox-design.md`](./sandbox-design.md)
- API contract: [`external-widget-contract.md`](./external-widget-contract.md)
</content>
</invoke>
