import { app, BrowserWindow, globalShortcut, ipcMain, Menu, session, shell, Tray } from 'electron'
import { Channels } from '@shared/ipc/channels'
import { registerIpcHandlers } from '@main/ipc/registerHandlers'
import { initScheduler } from '@main/poll/scheduler'
import { persistence } from '@main/persistence/store'
import { createTrayIcon } from '@main/tray/icon'
import { initClipboard } from '@main/clipboard/manager'
import { registerClipboardHandlers } from '@main/clipboard/ipc'
import { startCalendarMonitor } from '@main/calendar/monitor'
import {
  createClipboardPicker,
  notifyClipboardPicker,
  toggleClipboardPicker
} from '@main/windows/clipboardPicker'
import {
  createWindow,
  pinToDesktopLevel,
  raiseWindowToHud,
  setHudMode,
  type WindowMode
} from '@main/windows/createWindow'
import { registerSandboxScheme, registerSandboxProtocol } from '@main/sandbox/protocol'
import { registerNativeHandlers } from '@main/native/lane'

// Declare the sandbox widget scheme BEFORE app `ready` (Electron requirement) so it has a
// real, secure origin for the strict CSP that isolates third-party widgets.
registerSandboxScheme()

// Spike #1b: run the proven widget board ON the interactive desktop layer.
// Flip to 'windowed' for plain windowed development.
const WINDOW_MODE: WindowMode = 'desktop'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let hudActive = false
// The currently-registered accelerators (empty = none). Owned here so the prefs
// IPC handler can swap them at runtime.
let currentHotkey = ''
let currentClipboardHotkey = ''

/**
 * HUD mode: raise the always-present desktop layer ABOVE every window and dim the
 * backdrop. Toggling off drops it back to the desktop level — sinking behind your
 * apps again.
 */
function setHud(active: boolean): void {
  if (!win || active === hudActive) return
  hudActive = active
  setHudMode(active) // stop the desktop-level re-pin on `show` while HUD is up
  if (active) {
    // Single authority: the native addon sets level + collection-behavior
    // (CanJoinAllSpaces | FullScreenAuxiliary) + orders it front. The window is a
    // non-activating panel (see createWindow), the one window kind macOS lets float
    // over another app's full-screen Space without activation / a Space switch.
    raiseWindowToHud(win)
  } else if (WINDOW_MODE === 'desktop') {
    pinToDesktopLevel(win)
  }
  win.webContents.send(Channels.hudState, active)
  updateTrayMenu()
}

/**
 * (Re)register the global HUD hotkey. Returns false if the accelerator can't be
 * registered (reserved / already taken); in that case the previous binding is
 * restored so we're never left unbound. Used at startup and from the prefs IPC.
 */
function registerHudHotkey(accel: string): boolean {
  const prev = currentHotkey
  if (prev) globalShortcut.unregister(prev)
  if (!accel) {
    currentHotkey = ''
    updateTrayMenu()
    return true
  }
  if (globalShortcut.register(accel, () => setHud(!hudActive))) {
    currentHotkey = accel
    updateTrayMenu()
    return true
  }
  if (prev) globalShortcut.register(prev, () => setHud(!hudActive))
  currentHotkey = prev
  updateTrayMenu()
  return false
}

/** (Re)register the global clipboard-manager hotkey, restoring the prior one on failure. */
function registerClipboardHotkey(accel: string): boolean {
  const prev = currentClipboardHotkey
  if (prev) globalShortcut.unregister(prev)
  if (!accel) {
    currentClipboardHotkey = ''
    return true
  }
  if (globalShortcut.register(accel, () => toggleClipboardPicker())) {
    currentClipboardHotkey = accel
    return true
  }
  if (prev) globalShortcut.register(prev, () => toggleClipboardPicker())
  currentClipboardHotkey = prev
  return false
}

/** Bring the layer up and ask the renderer to open Settings (from the tray menu). */
function openPreferences(): void {
  if (!win) return
  setHud(true)
  win.webContents.send(Channels.uiOpenSettings)
}

// macOS delivers a `.garret` double-click / "Open With…" via the 'open-file' event, which can
// fire BEFORE the window exists (cold launch). Queue those; the renderer drains the queue once
// it has mounted its listener (flushOpenFiles). Runtime opens deliver immediately. Either way
// we surface the board (setHud) so the consent dialog is visible over other apps.
const pendingGarretOpens: string[] = []
function deliverGarretOpen(path: string): void {
  const wc = win?.webContents
  if (wc && !wc.isLoading()) {
    setHud(true)
    wc.send(Channels.sandboxOpenFile, path)
  } else {
    pendingGarretOpens.push(path)
  }
}
app.on('open-file', (e, openedPath) => {
  e.preventDefault()
  if (openedPath.toLowerCase().endsWith('.garret')) deliverGarretOpen(openedPath)
})
ipcMain.on(Channels.sandboxFlushOpenFiles, (e) => {
  for (const path of pendingGarretOpens.splice(0)) {
    setHud(true)
    e.sender.send(Channels.sandboxOpenFile, path)
  }
})

function updateTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: hudActive ? 'Hide Overlay' : 'Show Overlay',
        accelerator: currentHotkey || undefined,
        click: () => setHud(!hudActive)
      },
      { type: 'separator' },
      { label: 'Preferences…', click: openPreferences },
      { type: 'separator' },
      { label: 'Quit Garret', accelerator: 'CommandOrControl+Shift+Q', click: () => app.quit() }
    ])
  )
}

// Single-instance lock: only one Garret may own the global hotkeys + data store.
// A second launch (incl. running `npm run dev` alongside the installed app) just
// summons the existing instance's overlay instead of double-registering everything.
const gotInstanceLock = app.requestSingleInstanceLock()
if (!gotInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => setHud(true))
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return
  // Accessory (agent) app: no Dock icon, and — crucially — lets the HUD overlay
  // float over other apps' true full-screen Spaces WITHOUT a Space switch (a
  // regular Dock-activating app can't, which caused the flicker over full-screen).
  if (process.platform === 'darwin') app.dock?.hide()

  registerIpcHandlers({
    setHudHotkey: registerHudHotkey,
    setClipboardHotkey: registerClipboardHotkey,
    refreshCalendarMonitor: startCalendarMonitor
  })
  registerClipboardHandlers()

  // Webview guests must never spawn an in-app popup: an unhandled window.open also crashes
  // the main process with "Render frame was disposed before WebFrameMain could be accessed"
  // (Electron touches the popup's frame after it's torn down). Web-embed guests open http(s)
  // links in the user's browser; sandbox guests (garret-widget://) deny silently — they must
  // route links through sdk.openExternal, which prompts the user.
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      const fromSandbox = contents.getURL().startsWith('garret-widget:')
      if (!fromSandbox && /^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  // Serve garret-widget:// on the default session. SandboxWidget (step 5) also registers
  // it on each widget's partition session, where the isolated webviews actually load.
  registerSandboxProtocol(session.defaultSession.protocol)

  // Host-renderer CSP — applied in BOTH dev and production. (Gating it to packaged builds
  // hid CSP-violation bugs until release and left dev with no policy at all.) Production is
  // strict; dev additionally permits Vite's eval/inline HMR + its dev-server websocket.
  //
  // `frame-src` must allow `https:` because the Web-embed widget loads user-chosen sites in a
  // <webview> — a `garret-widget:`-only frame-src (per design §11) would break it. `https:`
  // + `garret-widget:` covers both real cases; `http:`/`data:`/`blob:` frames stay blocked.
  // Marketplace metadata (names/descriptions/icons) must be rendered as inert text + img-src
  // images, never framed.
  {
    const dev = !app.isPackaged
    const HOST_CSP = [
      "default-src 'self'",
      dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:", // widget preview images arrive as data: URLs (sandbox.previewDataUrl)
      "font-src 'self' data:",
      dev ? "connect-src 'self' http: https: ws: wss:" : "connect-src 'self' https: wss:",
      "frame-src 'self' garret-widget: garret-native: https:",
      "object-src 'none'",
      "base-uri 'none'"
    ].join('; ')
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      // Never override the sandbox protocol's own stricter WIDGET_CSP if a garret-widget://
      // response is served on the default session — leave those headers untouched.
      if (details.url.startsWith('garret-widget:')) return cb({})
      cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [HOST_CSP] } })
    })
  }
  initScheduler()

  registerNativeHandlers() // native-extension lane (renderer ↔ main ↔ raw-Node host)

  win = createWindow(WINDOW_MODE)

  // Clipboard manager: history capture + the (hidden) picker panel.
  createClipboardPicker()
  initClipboard(notifyClipboardPicker)

  // Background calendar notifications + reminders (idle unless enabled + connected).
  startCalendarMonitor()

  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())
  const prefs = persistence.getPreferences()
  registerHudHotkey(prefs.hudHotkey)
  registerClipboardHotkey(prefs.clipboardHotkey)
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin })

  // Menu-bar presence — the primary entry point since we run without a Dock icon.
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Garret')
  updateTrayMenu()

  // Renderer can dismiss (Esc / backdrop click). Dismiss-on-blur is intentionally
  // omitted: activating the app emits a transient blur that would instantly close
  // the HUD (the flicker). Esc / hotkey / backdrop-click cover dismissal.
  ipcMain.on(Channels.hudSet, (_e, active: boolean) => setHud(active))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow(WINDOW_MODE)
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
