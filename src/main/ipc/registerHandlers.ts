import { execFile } from 'node:child_process'
import { app, ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { Channels, type WatchOptions } from '@shared/ipc/channels'
import type { BoardState } from '@shared/types/board'
import type { WatchSpec } from '@shared/types/poll'
import type { Preferences } from '@shared/types/preferences'
import { persistence } from '@main/persistence/store'
import { getService } from '@main/services/registry'
import * as scheduler from '@main/poll/scheduler'
import { subscribeWatch, unsubscribeWatch, teardownWatchSender } from '@main/watcher'
import { listExternalWidgets } from '@main/plugins/externalWidgets'
import { sandboxFetch, devFetch } from '@main/sandbox/net'
import {
  bridgePreloadPath,
  prepareSandboxPartition,
  listSandboxedWidgets
} from '@main/sandbox/session'
import {
  planInstall,
  planInstallFromFile,
  cleanupStaging,
  commitInstall,
  removeWidget,
  setEnabled,
  recordUsage
} from '@main/sandbox/install'
import type { InstallPlan } from '@shared/types/sandbox'

/** Hooks the main process provides to IPC handlers (things outside the persistence layer). */
export interface IpcHooks {
  /** Apply a new HUD hotkey. Returns false if the accelerator couldn't be registered. */
  setHudHotkey(accelerator: string): boolean
  /** Apply a new clipboard-manager hotkey. Returns false if it couldn't be registered. */
  setClipboardHotkey(accelerator: string): boolean
  /** (Re)start the background calendar monitor (after prefs or Google connect/disconnect). */
  refreshCalendarMonitor(): void
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
  ipcMain.handle(Channels.pluginsListExternal, () => listExternalWidgets())
  // Host-mediated fetch for external widgets (no CORS); structured result, never throws.
  // Sandbox path (opts.allowedHosts) adds the per-host allowlist + resolved-IP rebind guard;
  // the dev tier is bounded but unrestricted. Both live in @main/sandbox/net.
  ipcMain.handle(
    Channels.pluginsFetch,
    (
      _e,
      url: string,
      init?: { method?: string; headers?: Record<string, string>; body?: string },
      opts?: { allowedHosts?: string[] }
    ) => (opts?.allowedHosts ? sandboxFetch(url, init, opts.allowedHosts) : devFetch(url, init))
  )

  // Native confirm before a sandboxed widget opens a URL — never silent.
  ipcMain.handle(Channels.pluginsOpenExternal, async (e, url: string): Promise<boolean> => {
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      return false
    }
    if (scheme !== 'http:' && scheme !== 'https:') return false
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      type: 'question' as const,
      buttons: ['Open', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Open this link in your browser?',
      detail: url
    }
    const { response } = win
      ? await dialog.showMessageBox(win, opts)
      : await dialog.showMessageBox(opts)
    if (response === 0) {
      void shell.openExternal(url)
      return true
    }
    return false
  })

  ipcMain.handle(Channels.sandboxPrepare, (_e, partition: string) => {
    prepareSandboxPartition(partition)
    return { preloadUrl: bridgePreloadPath() }
  })
  ipcMain.handle(Channels.sandboxList, () => listSandboxedWidgets())
  ipcMain.handle(Channels.sandboxInstallPlan, (_e, srcDir: string) => planInstall(srcDir))
  ipcMain.handle(Channels.sandboxInstallFromFile, (_e, p: string) => planInstallFromFile(p))
  ipcMain.handle(Channels.sandboxInstallCleanup, (_e, dir: string) => cleanupStaging(dir))
  ipcMain.handle(Channels.sandboxInstallCommit, (_e, plan: InstallPlan) => commitInstall(plan))
  ipcMain.handle(Channels.sandboxRemove, (_e, id: string) => removeWidget(id))
  ipcMain.handle(Channels.sandboxSetEnabled, (_e, id: string, on: boolean) => setEnabled(id, on))
  ipcMain.on(Channels.sandboxRecordUsage, (_e, id: string, caps: string[]) => {
    void recordUsage(id, caps)
  })

  ipcMain.handle(Channels.serviceStatus, (_e, id: string) => getService(id).status())
  ipcMain.handle(Channels.serviceConnect, async (_e, id: string, creds: Record<string, unknown>) => {
    const status = await getService(id).connect(creds)
    if (status.connected) scheduler.clearServiceGate(id) // re-enable polling after reconnect
    if (id === 'google') hooks.refreshCalendarMonitor()
    return status
  })
  ipcMain.handle(Channels.serviceDisconnect, async (_e, id: string) => {
    const status = await getService(id).disconnect()
    if (id === 'google') hooks.refreshCalendarMonitor()
    return status
  })

  ipcMain.handle(Channels.layoutsAllWidgets, () => persistence.allWidgets())

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
    if (
      'calendarNotifyChanges' in patch ||
      'calendarRemindBefore' in patch ||
      'calendarSyncMin' in patch
    ) {
      hooks.refreshCalendarMonitor()
    }
    if ('openAtLogin' in patch && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin })
    }
    return { ok: true, prefs }
  })

  // ---- Per-webContents teardown (poll subscriptions + file watchers) ----
  const senders = new Set<number>()
  const teardown = (wcId: number): void => {
    scheduler.teardownSender(wcId)
    teardownWatchSender(wcId)
  }
  const trackSender = (sender: Electron.WebContents): void => {
    const wcId = sender.id
    if (senders.has(wcId)) return
    senders.add(wcId)
    sender.once('destroyed', () => {
      teardown(wcId)
      senders.delete(wcId)
    })
    sender.on('did-start-navigation', (_ev, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) teardown(wcId)
    })
  }

  // ---- Poll scheduler ----
  ipcMain.handle(
    Channels.pollSubscribe,
    (
      e,
      subId: string,
      key: string,
      serviceId: string,
      method: string,
      params: Record<string, unknown>,
      intervalMs: number
    ) => {
      trackSender(e.sender)
      return scheduler.subscribe(subId, key, serviceId, method, params, intervalMs, e.sender.id)
    }
  )
  ipcMain.on(Channels.pollUnsubscribe, (_e, subId: string) => scheduler.unsubscribe(subId))
  ipcMain.on(Channels.pollRefresh, (_e, key: string) => scheduler.refresh(key))
  ipcMain.on(Channels.notifySyncWatches, (_e, watches: WatchSpec[]) =>
    scheduler.syncWatches(watches)
  )

  // ---- File watcher ----
  ipcMain.on(
    Channels.watchSubscribe,
    (e, watchId: string, paths: string[], opts: WatchOptions) => {
      trackSender(e.sender)
      subscribeWatch(watchId, paths, e.sender.id, opts)
    }
  )
  ipcMain.on(Channels.watchUnsubscribe, (_e, watchId: string) => unsubscribeWatch(watchId))
  ipcMain.handle(
    Channels.serviceQuery,
    (_e, id: string, method: string, params: Record<string, unknown>) =>
      getService(id).query(method, params)
  )

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
