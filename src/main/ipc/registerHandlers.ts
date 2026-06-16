import { execFile } from 'node:child_process'
import { ipcMain, BrowserWindow, shell, dialog } from 'electron'
import { Channels, type WatchOptions } from '@shared/ipc/channels'
import type { BoardState } from '@shared/types/board'
import type { WatchSpec } from '@shared/types/poll'
import { persistence } from '@main/persistence/store'
import { getService } from '@main/services/registry'
import * as scheduler from '@main/poll/scheduler'
import { subscribeWatch, unsubscribeWatch, teardownWatchSender } from '@main/watcher'

/** Binds the shared IPC channels to their main-process handlers. Call once on ready. */
export function registerIpcHandlers(): void {
  ipcMain.handle(Channels.boardLoad, () => persistence.loadBoard())
  ipcMain.handle(Channels.boardSave, (_e, state: BoardState) => persistence.saveBoard(state))

  ipcMain.handle(Channels.layoutsList, () => persistence.listLayouts())
  ipcMain.handle(Channels.layoutsSwitch, (_e, name: string) => persistence.switchLayout(name))
  ipcMain.handle(Channels.layoutsCreate, (_e, name: string) => persistence.createLayout(name))
  ipcMain.handle(Channels.layoutsRename, (_e, from: string, to: string) =>
    persistence.renameLayout(from, to)
  )
  ipcMain.handle(Channels.layoutsDelete, (_e, name: string) => persistence.deleteLayout(name))

  ipcMain.handle(Channels.serviceStatus, (_e, id: string) => getService(id).status())
  ipcMain.handle(Channels.serviceConnect, async (_e, id: string, creds: Record<string, unknown>) => {
    const status = await getService(id).connect(creds)
    if (status.connected) scheduler.clearServiceGate(id) // re-enable polling after reconnect
    return status
  })
  ipcMain.handle(Channels.serviceDisconnect, (_e, id: string) => getService(id).disconnect())

  ipcMain.handle(Channels.layoutsAllWidgets, () => persistence.allWidgets())

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
