import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray } from 'electron'
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

app.whenReady().then(() => {
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
  initScheduler()
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
