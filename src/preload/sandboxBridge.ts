import { contextBridge, ipcRenderer } from 'electron'
import type { BridgeTransport, GuestMessage, HostMessage } from 'garret-core'

/**
 * Bridge preload for sandboxed widget webviews — the ENTIRE guest-side trust boundary.
 *
 * HARD CONSTRAINT (see docs/sandbox-design.md §4): it must use ONLY
 * `ipcRenderer.sendToHost` / `ipcRenderer.on('garret:msg')`. It must NEVER use
 * `ipcRenderer.invoke`/`send`, which would reach `ipcMain` directly and bypass the host
 * BridgeHost's permission enforcement. (Enforced by an ESLint rule in step 6.)
 *
 * It exposes only a thin message transport — no capability — to the guest realm.
 */
const transport: BridgeTransport = {
  post: (msg: GuestMessage) => ipcRenderer.sendToHost('garret:msg', msg),
  onMessage: (cb: (msg: HostMessage) => void) =>
    ipcRenderer.on('garret:msg', (_e, msg: HostMessage) => cb(msg))
}

contextBridge.exposeInMainWorld('__garretBridge', transport)
