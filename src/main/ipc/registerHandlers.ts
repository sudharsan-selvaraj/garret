import { ipcMain, BrowserWindow, shell } from 'electron'
import { Channels } from '@shared/ipc/channels'
import type { BoardState } from '@shared/types/board'
import type { WatchSpec } from '@shared/types/poll'
import { persistence } from '@main/persistence/store'
import { getService } from '@main/services/registry'
import * as scheduler from '@main/poll/scheduler'

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

  // ---- Poll scheduler ----
  const senders = new Set<number>()
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
      const wcId = e.sender.id
      if (!senders.has(wcId)) {
        senders.add(wcId)
        e.sender.once('destroyed', () => {
          scheduler.teardownSender(wcId)
          senders.delete(wcId)
        })
        e.sender.on('did-start-navigation', (_ev, _url, isInPlace, isMainFrame) => {
          if (isMainFrame && !isInPlace) scheduler.teardownSender(wcId)
        })
      }
      return scheduler.subscribe(subId, key, serviceId, method, params, intervalMs, wcId)
    }
  )
  ipcMain.on(Channels.pollUnsubscribe, (_e, subId: string) => scheduler.unsubscribe(subId))
  ipcMain.on(Channels.pollRefresh, (_e, key: string) => scheduler.refresh(key))
  ipcMain.on(Channels.notifySyncWatches, (_e, watches: WatchSpec[]) =>
    scheduler.syncWatches(watches)
  )
  ipcMain.handle(
    Channels.serviceQuery,
    (_e, id: string, method: string, params: Record<string, unknown>) =>
      getService(id).query(method, params)
  )

  ipcMain.on(Channels.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
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
