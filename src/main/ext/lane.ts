import { app, ipcMain, session, webContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Channels } from '@shared/ipc/channels'
import type { WireMessage } from '@garretapp/sdk'
import type { ExtRuntimeInfo, ExtInstallPlan } from '@shared/types/ext'
import { registerExtProtocol, setUiResolver, resetUiDirs } from '@main/ext/protocol'
import { launchHost, getHost, killHost } from '@main/ext/host'
import { platformCall, type Binding } from '@main/ext/broker'
import {
  resolveEnabled,
  planInstall,
  planInstallFromFile,
  commitInstall,
  cleanupStaging,
  listInstalled,
  setEnabled,
  removeExtension
} from '@main/ext/install'

/**
 * The unified extension lane (main): the renderer↔main↔host relay, the capability-broker IPC, the
 * board loader, and install/manage. One host per placed instance (keyed by the UI webview's
 * webContents id). See docs/architecture.md § 2 + § 5.
 */
export const EXT_PARTITION = 'persist:garret-ext'

// webContents id → the extension bound to that widget webview (for the broker + host routing).
const bound = new Map<number, Binding>()

function extPreloadUrl(): string {
  return pathToFileURL(join(app.getAppPath(), 'out', 'preload', 'extBridge.js')).toString()
}

async function syncUiDirs(): Promise<void> {
  resetUiDirs((await resolveEnabled()).map((e) => ({ id: e.id, dir: e.uiDir, tier: e.tier })))
}

/** Broadcast board activity to every bound widget (drives useActive / g.active). */
export function broadcastActive(active: boolean): void {
  for (const wcId of bound.keys()) webContents.fromId(wcId)?.send(Channels.extActive, active)
}

export function registerExtHandlers(): void {
  registerExtProtocol(session.defaultSession.protocol)
  registerExtProtocol(session.fromPartition(EXT_PARTITION).protocol)
  setUiResolver(async (id) => {
    const ext = (await resolveEnabled()).find((e) => e.id === id)
    return ext ? { dir: ext.uiDir, tier: ext.tier } : null
  })
  void syncUiDirs()

  // ── board loader ────────────────────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.extList, async () => ({
    preloadUrl: extPreloadUrl(),
    extensions: (await resolveEnabled()).map(
      (e): ExtRuntimeInfo => ({
        id: e.id,
        name: e.name,
        tier: e.tier,
        uiUrl: `garret://${e.id}/`,
        hasHost: e.nodeEntry !== undefined,
        capabilities: e.capabilities,
        defaultSize: e.defaultSize
      })
    )
  }))

  // ── bind a placed widget webview to its extension (launch the host if full tier) ─────────────
  ipcMain.handle(Channels.extBind, async (_e, extensionId: string, instanceId: string, wcId: number) => {
    const ext = (await resolveEnabled()).find((x) => x.id === extensionId)
    if (!ext) return { ok: false, error: `unknown extension: ${extensionId}` }
    bound.set(wcId, { extId: ext.id, instanceId, tier: ext.tier, capabilities: ext.capabilities })
    if (ext.nodeEntry) {
      try {
        const host = await launchHost(wcId, ext.id, ext.nodeEntry)
        host.onFrame((msg) => webContents.fromId(wcId)?.send(Channels.extHostFrame, msg))
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    return { ok: true, hasHost: ext.nodeEntry !== undefined }
  })
  ipcMain.handle(Channels.extUnbind, async (_e, wcId: number) => {
    bound.delete(wcId)
    await killHost(wcId)
  })

  // ── host relay (renderer ⇄ host frames) ───────────────────────────────────────────────────────
  ipcMain.on(Channels.extHostSend, (e, msg: WireMessage) => {
    void getHost(e.sender.id)?.send(msg)
  })

  // ── capability broker ─────────────────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.extPlatform, async (e, domain: string, op: string, args: unknown[]) => {
    const binding = bound.get(e.sender.id)
    if (!binding) throw new Error('widget not bound')
    return platformCall(binding, domain, op, args ?? [])
  })

  // ── install / manage ────────────────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.extInstallPlan, (_e, dir: string) => planInstall(dir))
  ipcMain.handle(Channels.extInstallFromFile, (_e, p: string) => planInstallFromFile(p))
  ipcMain.handle(Channels.extInstallCleanup, (_e, dir: string) => cleanupStaging(dir))
  ipcMain.handle(Channels.extInstallCommit, async (_e, plan: ExtInstallPlan) => {
    const res = await commitInstall(plan)
    if (res.ok) await syncUiDirs()
    return res
  })
  ipcMain.handle(Channels.extListInstalled, () => listInstalled())
  ipcMain.handle(Channels.extSetEnabled, async (_e, id: string, on: boolean) => {
    const res = await setEnabled(id, on)
    if (res.ok) await syncUiDirs()
    return res
  })
  ipcMain.handle(Channels.extRemove, async (_e, id: string) => {
    await removeExtension(id)
    await syncUiDirs()
  })

  // Clean up a bound host when its renderer goes away.
  app.on('web-contents-created', (_e, contents) => {
    contents.on('destroyed', () => {
      if (bound.has(contents.id)) {
        bound.delete(contents.id)
        void killHost(contents.id)
      }
    })
  })
}
