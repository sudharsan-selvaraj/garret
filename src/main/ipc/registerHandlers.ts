import { execFile } from 'node:child_process'
import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { Channels, type WatchOptions } from '@shared/ipc/channels'
import type { BoardState } from '@shared/types/board'
import type { WatchSpec } from '@shared/types/poll'
import type { Preferences } from '@shared/types/preferences'
import { persistence } from '@main/persistence/store'
import { getService } from '@main/services/registry'
import * as scheduler from '@main/poll/scheduler'
import { subscribeWatch, unsubscribeWatch, teardownWatchSender } from '@main/watcher'
import { listExternalWidgets } from '@main/plugins/externalWidgets'

/** Hooks the main process provides to IPC handlers (things outside the persistence layer). */
export interface IpcHooks {
  /** Apply a new HUD hotkey. Returns false if the accelerator couldn't be registered. */
  setHudHotkey(accelerator: string): boolean
  /** Apply a new clipboard-manager hotkey. Returns false if it couldn't be registered. */
  setClipboardHotkey(accelerator: string): boolean
  /** (Re)start the background calendar monitor (after prefs or Google connect/disconnect). */
  refreshCalendarMonitor(): void
}

/** Friendly message for a failed host-mediated fetch. */
function fetchErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'Request timed out' : err.message
  return String(err)
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
  // Host-mediated fetch for external widgets (no CORS). Returns a structured
  // result (never throws) so the renderer gets clean errors. Bounded even in the
  // dev tier: http(s) only, 10s timeout, 5MB streamed cap. The per-host allowlist
  // / permission gating is the sandbox tier — this just removes the foot-cannon.
  const FETCH_TIMEOUT_MS = 10_000
  const FETCH_MAX_BYTES = 5 * 1024 * 1024
  ipcMain.handle(Channels.pluginsFetch, async (_e, url: string, init?: RequestInit) => {
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      return { ok: false, status: 0, error: 'Invalid URL' }
    }
    if (scheme !== 'http:' && scheme !== 'https:') {
      return { ok: false, status: 0, error: 'Only http(s) URLs are allowed' }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      const reader = res.body?.getReader()
      const chunks: Buffer[] = []
      let received = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > FETCH_MAX_BYTES) {
            controller.abort()
            return { ok: false, status: res.status, error: 'Response too large (>5MB)' }
          }
          chunks.push(Buffer.from(value))
        }
      }
      const text = Buffer.concat(chunks).toString('utf8')
      let data: unknown
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
      return { ok: res.ok, status: res.status, data }
    } catch (err) {
      return { ok: false, status: 0, error: fetchErrorMessage(err) }
    } finally {
      clearTimeout(timer)
    }
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
