import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Preload injected into a NATIVE extension's UI webview. Exposes `window.garret.native` so the
 * UI can call its Node host (a utilityProcess, main-brokered) and receive events. Main routes a
 * request to the host bound to THIS webview's webContents id. No capability gate — native
 * extensions are full-access by design.
 *
 * Channel strings are HARDCODED (not imported from @shared/ipc/channels) on purpose: a bridge
 * preload must be self-contained. If two preload entries import a shared module, Rollup hoists
 * it into a chunk, and Electron's preload loader can't resolve `./chunks/...` — which silently
 * breaks the MAIN preload too. Keep these in sync with Channels.nativeExtRequest/Event.
 */
const REQUEST = 'native-ext:request'
const EVENT = 'native-ext:event'

contextBridge.exposeInMainWorld('garret', {
  native: {
    request: (method: string, args?: unknown): Promise<unknown> =>
      ipcRenderer.invoke(REQUEST, method, args),
    onEvent: (cb: (channel: string, payload: unknown) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, channel: string, payload: unknown): void =>
        cb(channel, payload)
      ipcRenderer.on(EVENT, listener)
      return () => ipcRenderer.removeListener(EVENT, listener)
    }
  }
})
