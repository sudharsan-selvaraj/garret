# Garret

A desktop **widget layer** — interactive widgets (Google Calendar, Jira board, todo list, …)
pinned *above the wallpaper but behind your application windows*, so they're always there
in the background of your day.

- **Stack:** Electron + Vite + React + TypeScript
- **Widgets (planned):** embedded web views (`<webview>`) so sites that block iframing
  (Google, Jira) still render and stay fully interactive.
- **Future:** optional Go sidecar for native API integrations (OAuth, polling, caching).

## Status

### Spike #1 — desktop layer ✅ (this build)
Proves the hardest requirement: a transparent, frameless window pinned to the macOS
**desktop window level** (`type: 'desktop'` → `kCGDesktopWindowLevel`). Renders a floating
clock card with no wallpaper-covering chrome.

**Known caveat:** a `type: 'desktop'` window does not receive mouse/keyboard input on macOS.
Interactivity comes in **Spike #1b** via a small native addon that sets a custom NSWindow
level while still accepting events.

### Roadmap
1. ✅ Spike #1 — macOS desktop-pinned transparent window
2. ⬜ Spike #1b — interactive desktop-level window (native NSWindow level)
3. ⬜ Spike #2 — Windows desktop pinning (WorkerW re-parenting)
4. ⬜ MVP — draggable/resizable widget canvas + one `<webview>` widget (Google Calendar)
5. ⬜ Add/remove widgets by URL, persist layout to disk
6. ⬜ Grid snapping, per-widget settings
7. ⬜ Go sidecar + native API widgets

## Develop

```bash
npm install
npm run dev      # launches the desktop layer (stop with Cmd+Shift+Q, or Ctrl+C in terminal)
npm run build    # type-checks + bundles main/preload/renderer
```
