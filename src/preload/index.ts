import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type GarretApi, type WindowRole } from '@shared/ipc/channels'
import type { WindowMode } from '@shared/types/window'

const modeArg = process.argv.find((a) => a.startsWith('--garret-mode='))
const windowMode = (modeArg?.split('=')[1] as WindowMode) ?? 'windowed'
const roleArg = process.argv.find((a) => a.startsWith('--garret-role='))
const windowRole = (roleArg?.split('=')[1] as WindowRole) ?? 'board'

const api: GarretApi = {
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
    addWidget: (name, widget) => ipcRenderer.invoke(Channels.layoutsAddWidget, name, widget),
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
  watch: {
    subscribe: (watchId, paths, opts) =>
      ipcRenderer.send(Channels.watchSubscribe, watchId, paths, opts),
    unsubscribe: (watchId) => ipcRenderer.send(Channels.watchUnsubscribe, watchId),
    onEvent: (cb) => {
      const listener = (_e: unknown, watchId: string): void => cb(watchId)
      ipcRenderer.on(Channels.watchEvent, listener)
      return () => ipcRenderer.removeListener(Channels.watchEvent, listener)
    }
  },
  hud: {
    set: (active) => ipcRenderer.send(Channels.hudSet, active),
    onState: (cb) => {
      const listener = (_e: unknown, active: boolean): void => cb(active)
      ipcRenderer.on(Channels.hudState, listener)
      return () => ipcRenderer.removeListener(Channels.hudState, listener)
    }
  },
  prefs: {
    get: () => ipcRenderer.invoke(Channels.prefsGet),
    set: (patch) => ipcRenderer.invoke(Channels.prefsSet, patch)
  },
  ui: {
    onOpenSettings: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(Channels.uiOpenSettings, listener)
      return () => ipcRenderer.removeListener(Channels.uiOpenSettings, listener)
    }
  },
  clipboard: {
    list: () => ipcRenderer.invoke(Channels.clipboardList),
    paste: (id) => ipcRenderer.send(Channels.clipboardPaste, id),
    delete: (id) => ipcRenderer.send(Channels.clipboardDelete, id),
    clear: () => ipcRenderer.send(Channels.clipboardClear),
    hide: () => ipcRenderer.send(Channels.clipboardHide),
    axStatus: () => ipcRenderer.invoke(Channels.clipboardAxStatus),
    openAccessibilitySettings: () => ipcRenderer.send(Channels.clipboardOpenAx),
    onChanged: (cb) => {
      const listener = (): void => cb()
      ipcRenderer.on(Channels.clipboardChanged, listener)
      return () => ipcRenderer.removeListener(Channels.clipboardChanged, listener)
    }
  },
  services: {
    status: (id) => ipcRenderer.invoke(Channels.serviceStatus, id),
    connect: (id, creds) => ipcRenderer.invoke(Channels.serviceConnect, id, creds),
    disconnect: (id) => ipcRenderer.invoke(Channels.serviceDisconnect, id),
    query: (id, method, params) => ipcRenderer.invoke(Channels.serviceQuery, id, method, params)
  },
  plugins: {
    listExternal: () => ipcRenderer.invoke(Channels.pluginsListExternal),
    fetch: (url, init, opts) => ipcRenderer.invoke(Channels.pluginsFetch, url, init, opts),
    openExternalConfirmed: (url) => ipcRenderer.invoke(Channels.pluginsOpenExternal, url)
  },
  sandbox: {
    prepare: (partition) => ipcRenderer.invoke(Channels.sandboxPrepare, partition),
    list: () => ipcRenderer.invoke(Channels.sandboxList),
    planInstall: (srcDir) => ipcRenderer.invoke(Channels.sandboxInstallPlan, srcDir),
    installFromFile: (p) => ipcRenderer.invoke(Channels.sandboxInstallFromFile, p),
    installCleanup: (source) => {
      void ipcRenderer.invoke(Channels.sandboxInstallCleanup, source)
    },
    commitInstall: (plan) => ipcRenderer.invoke(Channels.sandboxInstallCommit, plan),
    remove: (id) => ipcRenderer.invoke(Channels.sandboxRemove, id),
    setEnabled: (id, enabled) => ipcRenderer.invoke(Channels.sandboxSetEnabled, id, enabled),
    recordUsage: (id, attemptedBlocked) =>
      ipcRenderer.send(Channels.sandboxRecordUsage, id, attemptedBlocked),
    onOpenFile: (cb) => {
      const listener = (_e: unknown, path: string): void => cb(path)
      ipcRenderer.on(Channels.sandboxOpenFile, listener)
      return () => ipcRenderer.removeListener(Channels.sandboxOpenFile, listener)
    },
    flushOpenFiles: () => ipcRenderer.send(Channels.sandboxFlushOpenFiles)
  },
  openExternal: (url) => ipcRenderer.send(Channels.openExternal, url),
  openPath: (path) => ipcRenderer.send(Channels.openPath, path),
  openInEditor: (path, editor) => ipcRenderer.send(Channels.openInEditor, path, editor),
  pickDirectory: () => ipcRenderer.invoke(Channels.pickDirectory),
  pickGarretFile: () => ipcRenderer.invoke(Channels.pickGarretFile),
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
  windowMode,
  windowRole
}

contextBridge.exposeInMainWorld('garret', api)
