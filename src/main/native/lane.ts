import { app, ipcMain, session, webContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Channels } from '@shared/ipc/channels'
import type { NativeExtensionInfo } from '@shared/ipc/channels'
import { ExtensionHost, launchExtension, killExtension } from '@main/native/extensionHost'
import { registerNativeProtocol, setNativeUiDir } from '@main/native/protocol'

/** Shared session for native UI webviews; the garret-native:// protocol is registered on it. */
export const NATIVE_PARTITION = 'persist:garret-native'

/**
 * Native-extension lane (main): the renderer↔main↔utilityProcess relay that wires a native
 * extension's UI webview to its raw-Node host. One host per placed instance, keyed by the UI
 * webview's webContents id (unique per instance). Phase 2 hard-registers the "hello" fixture;
 * Phase 3 will resolve installed extensions instead.
 */

interface NativeExtension extends NativeExtensionInfo {
  /** Absolute path to the Node entry forked in the utilityProcess. */
  nodeEntry: string
  /** Absolute path to the UI directory served over garret-native://<id>/. */
  uiDir: string
}

function registry(): NativeExtension[] {
  const base = app.getAppPath()
  return [
    {
      id: 'hello',
      name: 'Hello (native)',
      nodeEntry: join(base, 'examples/native-hello/node/main.cjs'),
      uiDir: join(base, 'examples/native-hello/ui'),
      uiUrl: 'garret-native://hello/',
      defaultSize: { w: 4, h: 4 }
    }
  ]
}

/** file:// URL of the UI-bridge preload injected into native-extension webviews. */
function nativePreloadUrl(): string {
  return pathToFileURL(join(app.getAppPath(), 'out', 'preload', 'nativeBridge.js')).toString()
}

// UI webContents id → its running host + its event unsubscribe.
const bound = new Map<number, { host: ExtensionHost; off: () => void }>()

function stop(wcId: number): void {
  const entry = bound.get(wcId)
  if (!entry) return
  entry.off()
  killExtension(String(wcId))
  bound.delete(wcId)
}

export function registerNativeHandlers(): void {
  // Serve garret-native://<id>/ on the default session + the shared native partition (where the
  // UI webviews live), and map each extension's UI dir. Registered once at boot — no per-widget
  // prepare step (the id in the URL disambiguates, so a shared session is fine).
  registerNativeProtocol(session.defaultSession.protocol)
  registerNativeProtocol(session.fromPartition(NATIVE_PARTITION).protocol)
  for (const ext of registry()) setNativeUiDir(ext.id, ext.uiDir)

  ipcMain.handle(Channels.nativeExtList, () => ({
    preloadUrl: nativePreloadUrl(),
    extensions: registry().map(
      ({ id, name, uiUrl, defaultSize }): NativeExtensionInfo => ({ id, name, uiUrl, defaultSize })
    )
  }))

  ipcMain.handle(Channels.nativeExtStart, async (_e, extensionId: string, wcId: number) => {
    const ext = registry().find((x) => x.id === extensionId)
    if (!ext) return { ok: false, error: `unknown native extension: ${extensionId}` }
    stop(wcId) // idempotent (re-mount)
    try {
      const host = await launchExtension(String(wcId), ext.nodeEntry)
      // Forward host events to the UI webview.
      const off = host.onEvent((channel, payload) => {
        webContents.fromId(wcId)?.send(Channels.nativeExtEvent, channel, payload)
      })
      bound.set(wcId, { host, off })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Called BY the UI webview — e.sender.id is that webview's webContents id. The UI can fire a
  // request before start() (did-attach → async launch) finishes binding the host, so wait briefly.
  ipcMain.handle(Channels.nativeExtRequest, async (e, method: string, args: unknown) => {
    let entry = bound.get(e.sender.id)
    for (let i = 0; !entry && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 50))
      entry = bound.get(e.sender.id)
    }
    if (!entry) throw new Error('native extension host not running')
    return entry.host.request(method, args)
  })

  ipcMain.on(Channels.nativeExtStop, (_e, wcId: number) => stop(wcId))
}
