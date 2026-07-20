# 2 · Getting started

[← Overview](01-overview.md) · Next: [Architecture →](03-architecture.md)

## Run the app (development)

```bash
npm install
npm run setup:electron   # first time only — fetches the Electron binary (org-safe, no install scripts)
npm run dev              # electron-vite dev with HMR
```

The board starts ambient (on the desktop, behind your windows). Raise the HUD with the global hotkey
(default **⌘⇧Space**), or click the tray icon.

Useful checks:

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run knip        # dead-code / unused-dependency report
```

## Install a widget (as a user)

1. Open the **Add widget** dialog (the toolbar **+**), then **Manage widgets…** (or Settings → Widgets).
2. Pick a pack from the marketplace list and **Install**. If the pack ships a **host**, you'll see a
   "runs code on your computer" notice first.
3. Back in **Add widget**, the pack's widgets appear under their pack's group — **Add** one to the board.
4. Configure it: open the widget's **⋯ → Settings**, and for account-based packs, its pane in
   **Settings → <Pack>** (e.g. enter your Atlassian email + API token once; all its widgets share it).

Placed widgets persist across restarts and across **layouts** (named board arrangements you can switch
between). Right-click a widget for lock / opacity / colour / move-to-layout / remove.

## Your first widget (as an author) — 60-second version

```bash
# in a packs repo (see the Publishing guide)
mkdir -p packs/hello/ui/hello
```

`packs/hello/garret.manifest.json`:

```json
{
  "apiVersion": 2,
  "id": "you.hello",
  "publisher": "you",
  "name": "Hello",
  "version": "1.0.0",
  "description": "A hello-world widget.",
  "widgets": [
    { "id": "hello", "name": "Hello", "ui": "dist/hello", "capabilities": [], "defaultSize": { "w": 3, "h": 2 } }
  ]
}
```

`packs/hello/ui/hello/index.html`:

```html
<!doctype html>
<html>
  <head><link rel="stylesheet" href="~theme.css" /></head>
  <body><div id="root"></div><script type="module" src="app.js"></script></body>
</html>
```

`packs/hello/ui/hello/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { EmptyState } from '@garretapp/sdk/react'

createRoot(document.getElementById('root')!).render(<EmptyState>Hello from a pack 👋</EmptyState>)
```

Build it into a `.garret` and install it — see **[Build a widget](04-build-a-widget.md)** for the full
tutorial (storage, fetch, settings, commands, notifications) and **[Publishing](06-publishing.md)** for
the build + marketplace pipeline.

Next: [Architecture →](03-architecture.md)
