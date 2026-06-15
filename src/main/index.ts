import { app, BrowserWindow, globalShortcut } from 'electron'
import { registerIpcHandlers } from '@main/ipc/registerHandlers'
import { initScheduler } from '@main/poll/scheduler'
import { createWindow, type WindowMode } from '@main/windows/createWindow'

// Spike #1b: run the proven widget board ON the interactive desktop layer.
// Flip to 'windowed' for plain windowed development.
const WINDOW_MODE: WindowMode = 'desktop'

let win: BrowserWindow | null = null

app.whenReady().then(() => {
  registerIpcHandlers()
  initScheduler()
  win = createWindow(WINDOW_MODE)

  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow(WINDOW_MODE)
  })
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
