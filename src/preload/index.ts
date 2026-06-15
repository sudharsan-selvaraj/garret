import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type MyViewApi } from '@shared/ipc/channels'
import type { WindowMode } from '@shared/types/window'

const modeArg = process.argv.find((a) => a.startsWith('--myview-mode='))
const windowMode = (modeArg?.split('=')[1] as WindowMode) ?? 'windowed'

const api: MyViewApi = {
  board: {
    load: () => ipcRenderer.invoke(Channels.boardLoad),
    save: (state) => ipcRenderer.invoke(Channels.boardSave, state)
  },
  layouts: {
    list: () => ipcRenderer.invoke(Channels.layoutsList),
    switch: (name) => ipcRenderer.invoke(Channels.layoutsSwitch, name),
    create: (name) => ipcRenderer.invoke(Channels.layoutsCreate, name),
    rename: (from, to) => ipcRenderer.invoke(Channels.layoutsRename, from, to),
    delete: (name) => ipcRenderer.invoke(Channels.layoutsDelete, name),
    allWidgets: () => ipcRenderer.invoke(Channels.layoutsAllWidgets)
  },
  poll: {
    subscribe: (subId, key, serviceId, method, params, intervalMs) =>
      ipcRenderer.invoke(Channels.pollSubscribe, subId, key, serviceId, method, params, intervalMs),
    unsubscribe: (subId) => ipcRenderer.send(Channels.pollUnsubscribe, subId),
    refresh: (key) => ipcRenderer.send(Channels.pollRefresh, key),
    onUpdate: (cb) => {
      const listener = (_e: unknown, u: Parameters<typeof cb>[0]): void => cb(u)
      ipcRenderer.on(Channels.pollUpdate, listener)
      return () => ipcRenderer.removeListener(Channels.pollUpdate, listener)
    }
  },
  notify: {
    syncWatches: (watches) => ipcRenderer.send(Channels.notifySyncWatches, watches)
  },
  services: {
    status: (id) => ipcRenderer.invoke(Channels.serviceStatus, id),
    connect: (id, creds) => ipcRenderer.invoke(Channels.serviceConnect, id, creds),
    disconnect: (id) => ipcRenderer.invoke(Channels.serviceDisconnect, id),
    query: (id, method, params) => ipcRenderer.invoke(Channels.serviceQuery, id, method, params)
  },
  openExternal: (url) => ipcRenderer.send(Channels.openExternal, url),
  store: {
    get: (key) => ipcRenderer.invoke(Channels.storeGet, key),
    set: (key, value) => ipcRenderer.invoke(Channels.storeSet, key, value)
  },
  window: {
    setIgnoreMouseEvents: (ignore) => ipcRenderer.send(Channels.setIgnoreMouse, ignore),
    onCursorMove: (cb) => {
      const listener = (_e: unknown, pos: { x: number; y: number }): void => cb(pos)
      ipcRenderer.on(Channels.cursorPos, listener)
      return () => ipcRenderer.removeListener(Channels.cursorPos, listener)
    }
  },
  platform: process.platform,
  windowMode
}

contextBridge.exposeInMainWorld('myview', api)
