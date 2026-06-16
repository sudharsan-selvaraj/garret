import { join } from 'path'
import { BrowserWindow, screen } from 'electron'
import { makePanel, raiseToHud, rememberFrontmostApp } from '@main/native/macWindow'
import { Channels } from '@shared/ipc/channels'

const WIDTH = 680
const HEIGHT = 460

let picker: BrowserWindow | null = null

/** Create the (hidden) clipboard picker — a non-activating panel like the HUD. */
export function createClipboardPicker(): BrowserWindow {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: ['--myview-mode=windowed', '--myview-role=clipboard']
    }
  })

  // Non-activating panel so it can float over full-screen Spaces and accept typing
  // without activating our (dockless) app — same technique as the HUD overlay.
  makePanel(win.getNativeWindowHandle())
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Dismiss when the user clicks away.
  win.on('blur', () => hideClipboardPicker())

  picker = win
  return win
}

/** Summon the picker centered on the active display, over everything. */
export function showClipboardPicker(): void {
  if (!picker) return
  rememberFrontmostApp() // capture the app to paste back into

  const pt = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(pt).workArea
  picker.setBounds({
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + (area.height - HEIGHT) / 3), // upper third feels natural
    width: WIDTH,
    height: HEIGHT
  })

  raiseToHud(picker.getNativeWindowHandle()) // screen-saver level + full-screen-aux
  picker.show()
  picker.focus()
  picker.webContents.send(Channels.clipboardChanged) // tell the UI to reload + reset
}

export function hideClipboardPicker(): void {
  if (picker?.isVisible()) picker.hide()
}

export function toggleClipboardPicker(): void {
  if (!picker) return
  if (picker.isVisible()) hideClipboardPicker()
  else showClipboardPicker()
}

/** Push a "history changed" signal to the picker so it re-fetches. */
export function notifyClipboardPicker(): void {
  if (picker && !picker.isDestroyed()) picker.webContents.send(Channels.clipboardChanged)
}
