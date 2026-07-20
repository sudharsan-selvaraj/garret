# 4 · Build a widget

[← Architecture](03-architecture.md) · Next: [Host packs →](05-host-packs.md)

This is the end-to-end tutorial for a **UI-only** pack (no host). It runs entirely in the sandbox and
talks to the host through `@garretapp/sdk`. For OAuth / local processes, add a host —
see [Host packs](05-host-packs.md).

## Anatomy of a pack

```
packs/<pack>/
  garret.manifest.json        # identity + widgets + capabilities + settings
  ui/<widget>/
    index.html                # links ~theme.css + app.css + app.js
    main.tsx                  # your React entry (bundled → app.js)
    <widget>.css              # optional, imported from main.tsx → app.css
```

## 1. The manifest

```json
{
  "apiVersion": 2,
  "id": "acme.tasks",
  "publisher": "acme",
  "name": "Tasks",
  "version": "1.0.0",
  "description": "Your open tasks.",
  "shared": {
    "settings": { "schema": [
      { "key": "email",  "label": "Email",     "type": "string" },
      { "key": "token",  "label": "API token", "type": "secret" }
    ] }
  },
  "widgets": [
    {
      "id": "list",
      "name": "Tasks",
      "ui": "dist/list",
      "capabilities": ["secrets", "openExternal", "notify", "network:*.acme.com"],
      "defaultSize": { "w": 5, "h": 7 },
      "minSize": { "w": 3, "h": 3 }
    }
  ]
}
```

- **`shared.settings`** — one account shared by all the pack's widgets. Rendered by the host in
  **Settings → Tasks**; read via `g.shared.storage` / `g.shared.secrets`.
- **`settings`** (per widget, not shown) — placement-scoped config, read via `g.storage` / `g.secrets`.
- **Settings field** = `{ key, label, type: 'string'|'secret'|'number'|'boolean'|'select', options?, default?, placeholder? }`. `secret` routes to the encrypted store and is never read back into the UI.
- **`capabilities`** — declare only what you use. `storage` is free; `secrets`/`notify`/`openExternal`/`network:*` are gated. See [SDK reference §Capabilities](07-sdk-reference.md#capabilities).

## 2. The UI shell

`ui/list/index.html`:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="~theme.css" />  <!-- the shared --gx-* design system -->
    <link rel="stylesheet" href="app.css" />       <!-- your CSS, emitted from main.tsx imports -->
  </head>
  <body><div id="root"></div><script type="module" src="app.js"></script></body>
</html>
```

> **CSP:** widgets run under `script-src 'self'` — no inline scripts, no CDNs. Bundle everything into
> `app.js`. CSS must be a linked stylesheet (`app.css`, emitted when you `import './x.css'` from
> `main.tsx`) — a raw `<link>` to a non-emitted file won't be copied.

## 3. Fetch + render (with `usePoll` + `StatusStrip`)

```tsx
import { createRoot } from 'react-dom/client'
import {
  useGarret, useInstanceConfig, useWidgetMenu, usePoll,
  Scroll, Item, EmptyState, StatusStrip
} from '@garretapp/sdk/react'

interface Cfg { title: string; refreshMin: number }
const DEFAULTS: Cfg = { title: '', refreshMin: 5 }

function App(): JSX.Element {
  const g = useGarret()
  const { cfg, set, loaded } = useInstanceConfig<Cfg>(DEFAULTS)

  const load = async () => {
    const email = await g.shared.storage.get<string>('email')
    const token = await g.shared.secrets.get('token').catch(() => '')
    if (!email || !token) throw new Error('needs-setup')
    const res = await g.fetch(`https://api.acme.com/tasks?u=${email}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`Request failed (${res.status})`)
    return (await res.json<{ items: Task[] }>()).items
  }

  // Declarative polling: interval + active-gating + manual refresh + stale-while-error.
  const { data, error, loading, refresh } = usePoll(load, {
    intervalMs: Math.max(Number(cfg.refreshMin), 1) * 60_000,
    deps: [cfg.refreshMin],
    enabled: loaded
  })

  useWidgetMenu([{ id: 'refresh', label: 'Refresh', run: refresh }])
  useEffect(() => { if (loaded) g.setTitle(cfg.title.trim()) }, [g, loaded, cfg.title])

  if (!data) return error ? <EmptyState>Add your account in ⚙ Settings.</EmptyState> : <EmptyState>Loading…</EmptyState>
  return (
    <Scroll>
      <StatusStrip error={error} loading={loading} onRetry={refresh} />
      {data.map((t) => (
        <Item key={t.id} onClick={() => g.openExternal(t.url)}>{t.title}</Item>
      ))}
    </Scroll>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
```

Key pieces:

- **`useGarret()`** → `g`, the platform bridge (`storage`, `secrets`, `shared`, `fetch`, `notify`, …).
- **`useInstanceConfig(defaults)`** → per-placement config with a `loaded` flag. **Gate your first
  read on `loaded`** — calling `g.*` before the widget binds throws `widget not bound`.
- **`g.fetch`** returns a serializable `GarretResponse` (`.ok/.status/.json()/.text()`), not a DOM
  `Response`. Only hosts in your `network:*` caps are allowed.
- **`usePoll`** handles the interval, pauses when the board is idle, and keeps the last data on error.
- **components** (`Scroll`, `Item`, `EmptyState`, `StatusStrip`, …) emit `--gx-*` themed markup — see
  [SDK reference §Components](07-sdk-reference.md#components).

## 4. Settings UI

Per-placement config (filters, view options) is rendered by the widget itself:

```tsx
import { SettingsPanel, AutoForm } from '@garretapp/sdk/react'

// in App, toggled by a 'settings' command:
<SettingsPanel onDone={() => setShowCfg(false)}>
  <AutoForm
    schema={[
      { key: 'title', label: 'Title', type: 'text', placeholder: 'optional' },
      { key: 'refreshMin', label: 'Refresh (min)', type: 'number' }
    ]}
    value={cfg}
    onChange={set}
  />
</SettingsPanel>
```

Wire it to the ⋯ menu:

```tsx
useWidgetMenu([
  { id: 'settings', label: 'Settings', run: () => setShowCfg((s) => !s) },
  { id: 'refresh',  label: 'Refresh',  run: refresh }
])
```

`useWidgetMenu` declares commands the host renders in the widget's frame **⋯ menu** and dispatches
back — the generic mechanism for any frame action.

## 5. Custom title

`g.setTitle('My tasks')` overrides the frame's title text (empty → falls back to the widget name).

## Notifications

### Foreground (while the widget is open)

Diff freshly-fetched items against a persisted "seen" set and call `g.notify`:

```tsx
g.notify('3 new tasks', firstTask.title, { url: firstTask.url })  // clicking opens url
```

Notifications require the `notify` capability; click-through requires `openExternal`. Seed the seen-set
silently on first load so you don't alert the whole existing list.

### Background notifications

To alert **when the widget isn't even placed**, add a declarative **`notifier`** to the widget's
manifest. A single shared main-process loop runs it — no webview, negligible cost — polling on a
schedule, diffing new items, and firing click-through notifications.

```json
"notifier": {
  "auth": { "type": "basic", "user": "{shared.email}", "pass": "{secret.token}" },
  "request": {
    "url": "https://api.acme.com/tasks",
    "method": "GET",
    "headers": { "Accept": "application/json" }
  },
  "itemsPath": "items",
  "idField": "id",
  "titleTemplate": "New task: {item.title}",
  "urlTemplate": "{item.url}",
  "intervalMin": 5
}
```

- Templates: `{shared.KEY}` / `{secret.KEY}` (from the pack's shared store) in auth + request;
  `{item.dot.path}` in the title/body/url. Auth is `basic` or `bearer`.
- **Opt-in per pack:** the loop only runs when the pack's shared store has `bgNotify === true` — add a
  `{ "key": "bgNotify", "label": "Background notifications", "type": "boolean", "default": false }`
  field to `shared.settings.schema` so the user can turn it on.
- Gated by the widget's `notify` (+ `openExternal` for click) and `network:*` capabilities, exactly
  like the foreground path.

## Storage cheat-sheet

| API | Scope | Gated? |
|-----|-------|--------|
| `g.instanceStorage` | this placement only | no |
| `g.storage` | all instances of this widget | no |
| `g.shared.storage` | all widgets in the pack (needs `shared` in manifest) | no |
| `g.secrets` / `g.shared.secrets` | encrypted; per-widget / per-pack | `secrets` |

Next: [Host packs →](05-host-packs.md)
