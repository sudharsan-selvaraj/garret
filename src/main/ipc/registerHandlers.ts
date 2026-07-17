import { execFile } from 'node:child_process'
import { app, ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { Channels } from '@shared/ipc/channels'
import type { BoardState } from '@shared/types/board'
import type { Preferences } from '@shared/types/preferences'
import { persistence } from '@main/persistence/store'

/** Hooks the main process provides to IPC handlers (things outside the persistence layer). */
export interface IpcHooks {
  /** Apply a new HUD hotkey. Returns false if the accelerator couldn't be registered. */
  setHudHotkey(accelerator: string): boolean
  /** Apply a new clipboard-manager hotkey. Returns false if it couldn't be registered. */
  setClipboardHotkey(accelerator: string): boolean
}

/** Binds the shared IPC channels to their main-process handlers. Call once on ready. */
export function registerIpcHandlers(hooks: IpcHooks): void {
  ipcMain.handle(Channels.boardLoad, () => persistence.loadBoard())
  ipcMain.handle(Channels.boardSave, (_e, state: BoardState) => persistence.saveBoard(state))

  ipcMain.handle(Channels.layoutsList, () => persistence.listLayouts())
  ipcMain.handle(Channels.layoutsSwitch, (_e, name: string) => persistence.switchLayout(name))
  ipcMain.handle(Channels.layoutsCreate, (_e, name: string) => persistence.createLayout(name))
  ipcMain.handle(Channels.layoutsRename, (_e, from: string, to: string) =>
    persistence.renameLayout(from, to)
  )
  ipcMain.handle(Channels.layoutsDelete, (_e, name: string) => persistence.deleteLayout(name))
  ipcMain.handle(Channels.layoutsAddWidget, (_e, name: string, widget) =>
    persistence.addWidgetToLayout(name, widget)
  )

  // ---- App preferences ----
  ipcMain.handle(Channels.prefsGet, () => persistence.getPreferences())
  ipcMain.handle(Channels.prefsSet, (_e, patch: Partial<Preferences>) => {
    // Validate hotkeys by actually (re)registering them before persisting — a
    // combo the OS rejects (reserved / already taken) must not be saved.
    if (typeof patch.hudHotkey === 'string' && !hooks.setHudHotkey(patch.hudHotkey)) {
      return { ok: false, prefs: persistence.getPreferences() }
    }
    if (typeof patch.clipboardHotkey === 'string' && !hooks.setClipboardHotkey(patch.clipboardHotkey)) {
      return { ok: false, prefs: persistence.getPreferences() }
    }
    const prefs = persistence.setPreferences(patch)
    if ('openAtLogin' in patch && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin })
    }
    return { ok: true, prefs }
  })

  ipcMain.on(Channels.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.on(Channels.openPath, (_e, path: string) => {
    if (path) void shell.openPath(path)
  })

  const EDITOR_APPS: Record<string, string> = {
    vscode: 'Visual Studio Code',
    cursor: 'Cursor',
    intellij: 'IntelliJ IDEA'
  }
  ipcMain.on(Channels.openInEditor, (_e, path: string, editor: string) => {
    if (!path) return
    const app = EDITOR_APPS[editor]
    if (app) {
      execFile('open', ['-a', app, path], (err) => {
        if (err) void shell.openPath(path) // editor app not found → reveal in Finder
      })
    } else {
      void shell.openPath(path)
    }
  })

  ipcMain.handle(Channels.pickDirectory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = { properties: ['openDirectory' as const] }
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  ipcMain.handle(Channels.pickGarretFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: 'Garret widget', extensions: ['garret'] }]
    }
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  ipcMain.handle(Channels.storeGet, (_e, key: string) => persistence.kvGet(key))
  ipcMain.handle(Channels.storeSet, (_e, key: string, value: unknown) =>
    persistence.kvSet(key, value)
  )

  // Fire-and-forget for low-latency click-through toggling.
  ipcMain.on(Channels.setIgnoreMouse, (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return
    if (ignore) win.setIgnoreMouseEvents(true, { forward: true })
    else win.setIgnoreMouseEvents(false)
  })
}
