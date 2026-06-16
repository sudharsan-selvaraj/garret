import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron'
import { Channels } from '@shared/ipc/channels'
import { registerIpcHandlers } from '@main/ipc/registerHandlers'
import { initScheduler } from '@main/poll/scheduler'
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

// Global hotkey to summon the HUD (configurable later).
const HUD_HOTKEY = 'CommandOrControl+Shift+Space'

let win: BrowserWindow | null = null
let hudActive = false

/**
 * HUD mode: raise the always-present desktop layer ABOVE every window, focus it
 * (so Esc/keyboard work) and dim the backdrop. Toggling off drops it back to the
 * desktop level — sinking behind your apps again.
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
}

app.whenReady().then(() => {
  // Accessory (agent) app: no Dock icon, and — crucially — lets the HUD overlay
  // float over other apps' true full-screen Spaces WITHOUT a Space switch (a
  // regular Dock-activating app can't, which caused the flicker over full-screen).
  if (process.platform === 'darwin') app.dock?.hide()

  registerIpcHandlers()
  initScheduler()
  win = createWindow(WINDOW_MODE)

  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())
  globalShortcut.register(HUD_HOTKEY, () => setHud(!hudActive))

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
