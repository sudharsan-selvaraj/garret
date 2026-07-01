import { app, ipcMain, session, webContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Channels } from '@shared/ipc/channels'
import type { NativeExtensionInfo } from '@shared/ipc/channels'
import type { NativeInstallPlan } from '@shared/types/native'
import { ExtensionHost, launchExtension, killExtension } from '@main/native/extensionHost'
import {
  registerNativeProtocol,
  resetNativeUiDirs,
  setNativeUiResolver
} from '@main/native/protocol'
import {
  planInstall,
  planInstallFromFile,
  commitInstall,
  cleanupStaging,
  setEnabled,
  removeExtension,
  listInstalled,
  resolveEnabledRegistry
} from '@main/native/install'

/** Shared session for native UI webviews; the garret-native:// protocol is registered on it. */
export const NATIVE_PARTITION = 'persist:garret-native'

/**
 * Native-extension lane (main): the renderer↔main↔utilityProcess relay that wires a native
 * extension's UI webview to its raw-Node host, plus the install/enable/manage IPC. One host per
 * placed instance, keyed by the UI webview's webContents id.
 *
 * The set of loadable extensions comes from `resolveEnabledRegistry()` (install.ts) — only
 * enabled, authentic (MAC-verified), untampered installs. In DEV we additionally surface the
 * bundled `hello` fixture so the lane is testable without an install step; it never ships.
 */

interface NativeExtension extends NativeExtensionInfo {
  nodeEntry: string
  uiDir: string
}

/** DEV-only bundled fixture (not shipped). Proves the lane end to end without an install. */
function devFixtures(): NativeExtension[] {
  if (app.isPackaged) return []
  const base = app.getAppPath()
  return [
    {
      id: 'hello',
      name: 'Hello (native, dev)',
      nodeEntry: join(base, 'examples/native-hello/node/main.cjs'),
      uiDir: join(base, 'examples/native-hello/ui'),
      uiUrl: 'garret-native://hello/',
      defaultSize: { w: 4, h: 4 }
    }
  ]
}

/** All loadable native extensions: installed-enabled-and-valid + dev fixtures. */
async function registry(): Promise<NativeExtension[]> {
  const installed = (await resolveEnabledRegistry()).map(
    (e): NativeExtension => ({
      id: e.id,
      name: e.name,
      nodeEntry: e.nodeEntry,
      uiDir: e.uiDir,
      uiUrl: `garret-native://${e.id}/`,
      defaultSize: e.defaultSize
    })
  )
  // Dev fixture id can't collide with an installed one (ID_RE + separate origin); if it somehow
  // did, the installed one wins (filter it out of fixtures).
  const ids = new Set(installed.map((e) => e.id))
  return [...installed, ...devFixtures().filter((f) => !ids.has(f.id))]
}

/** Rebuild the UI-dir cache from the currently-loadable set (so disable/remove stop serving). */
async function syncUiDirs(): Promise<void> {
  resetNativeUiDirs((await registry()).map((ext) => ({ id: ext.id, dir: ext.uiDir })))
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
  registerNativeProtocol(session.defaultSession.protocol)
  registerNativeProtocol(session.fromPartition(NATIVE_PARTITION).protocol)
  // Lazy fallback: if a UI asset is requested before syncUiDirs runs (boot race), resolve the
  // enabled+valid extension's UI dir from disk on demand. `registry()` gates enabled/authentic.
  setNativeUiResolver(async (id) => (await registry()).find((e) => e.id === id)?.uiDir ?? null)
  void syncUiDirs()

  // --- board loader / host lane ---------------------------------------------------------------

  ipcMain.handle(Channels.nativeExtList, async () => ({
    preloadUrl: nativePreloadUrl(),
    extensions: (await registry()).map(
      ({ id, name, uiUrl, defaultSize }): NativeExtensionInfo => ({ id, name, uiUrl, defaultSize })
    )
  }))

  ipcMain.handle(Channels.nativeExtStart, async (_e, extensionId: string, wcId: number) => {
    const ext = (await registry()).find((x) => x.id === extensionId)
    if (!ext) return { ok: false, error: `unknown native extension: ${extensionId}` }
    stop(wcId) // idempotent (re-mount)
    try {
      const host = await launchExtension(String(wcId), ext.nodeEntry)
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

  // --- install / manage -----------------------------------------------------------------------

  ipcMain.handle(Channels.nativeExtInstallPlan, (_e, srcDir: string) => planInstall(srcDir))
  ipcMain.handle(Channels.nativeExtInstallFromFile, (_e, p: string) => planInstallFromFile(p))
  ipcMain.handle(Channels.nativeExtInstallCleanup, (_e, dir: string) => cleanupStaging(dir))
  ipcMain.handle(Channels.nativeExtInstallCommit, async (_e, plan: NativeInstallPlan) => {
    const res = await commitInstall(plan)
    if (res.ok) await syncUiDirs()
    return res
  })
  ipcMain.handle(Channels.nativeExtListInstalled, () => listInstalled())
  ipcMain.handle(Channels.nativeExtSetEnabled, async (_e, id: string, on: boolean) => {
    const res = await setEnabled(id, on)
    if (res.ok) await syncUiDirs()
    return res
  })
  ipcMain.handle(Channels.nativeExtRemove, async (_e, id: string) => {
    await removeExtension(id)
    await syncUiDirs()
  })
}
