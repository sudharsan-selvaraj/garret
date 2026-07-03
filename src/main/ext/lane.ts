import { app, ipcMain, session, webContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Channels } from '@shared/ipc/channels'
import type { WireMessage } from '@garretapp/sdk'
import type { ExtRuntimeInfo, ExtInstallPlan } from '@shared/types/ext'
import { persistence } from '@main/persistence/store'
import { registerExtProtocol, setUiResolver, resetUiDirs, EXT_PARTITION } from '@main/ext/protocol'
import { launchHost, getHost, killHost } from '@main/ext/host'
import { platformCall, type Binding } from '@main/ext/broker'
import {
  openSurface,
  closeSurface,
  focusSurface,
  initForWc,
  surfacePropsForBind,
  surfaceBelongsTo,
  setSurfaceAspectRatio,
  resizeSurface,
  closeSurfaceByEmbedder,
  repointOwner,
  closeSurfacesForOwner,
  closeSurfacesForExt,
  type SurfaceOpenOpts
} from '@main/windows/surfaceWindow'
import {
  resolveEnabled,
  planInstall,
  planInstallFromFile,
  commitInstall,
  cleanupStaging,
  listInstalled,
  setEnabled,
  removeExtension,
  type ResolvedExt
} from '@main/ext/install'

/**
 * The unified extension lane (main): the renderer↔main↔host relay, the capability-broker IPC, the
 * board loader, and install/manage. One host per placed instance (keyed by the UI webview's
 * webContents id). See docs/architecture.md § 2 + § 5.
 */

// webContents id → the extension bound to that widget webview (for the broker + host routing).
const bound = new Map<number, Binding>()

function extPreloadUrl(): string {
  return pathToFileURL(join(app.getAppPath(), 'out', 'preload', 'extBridge.js')).toString()
}

/** surfaceId → ui dir, for serving `garret://<id>/~<surfaceId>/` (undefined if the ext has none). */
function surfaceDirs(e: ResolvedExt): Record<string, string> | undefined {
  const s = e.spec.surfaces
  if (!s) return undefined
  const out: Record<string, string> = {}
  for (const [sid, spec] of Object.entries(s)) out[sid] = spec.uiDir
  return out
}

async function syncUiDirs(): Promise<void> {
  resetUiDirs(
    (await resolveEnabled()).map((e) => ({ id: e.id, dir: e.uiDir, tier: e.tier, surfaces: surfaceDirs(e) }))
  )
}

let currentActive = true
/** Broadcast board activity to every bound widget (drives useActive / g.active). */
export function broadcastActive(active: boolean): void {
  currentActive = active
  for (const wcId of bound.keys()) webContents.fromId(wcId)?.send(Channels.extActive, active)
}

/** Tear down every live binding + host for an extension (on disable / uninstall). */
async function revokeExt(extId: string): Promise<void> {
  closeSurfacesForExt(extId) // close its floating surface windows too (no stale capability ceiling)
  for (const [wcId, b] of [...bound]) {
    if (b.extId !== extId) continue
    bound.delete(wcId)
    await killHost(wcId)
  }
}

export function registerExtHandlers(): void {
  registerExtProtocol(session.defaultSession.protocol)
  registerExtProtocol(session.fromPartition(EXT_PARTITION).protocol)
  setUiResolver(async (id) => {
    const ext = (await resolveEnabled()).find((e) => e.id === id)
    return ext ? { dir: ext.uiDir, tier: ext.tier, surfaces: surfaceDirs(ext) } : null
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

  // ── bind: the widget guest binds ITSELF; we key on e.sender (unforgeable) + verify it is really
  //    running this extension's garret://<id>/ origin. A renderer cannot bind an arbitrary webview
  //    to another extension's capabilities (B2). Launch the host if full tier.
  ipcMain.handle(Channels.extBind, async (e, extensionId: string, instanceId: string) => {
    const wcId = e.sender.id
    let originOk = false
    try {
      const u = new URL(e.sender.getURL())
      originOk = u.protocol === 'garret:' && u.hostname === extensionId
    } catch {
      originOk = false
    }
    if (!originOk) return { ok: false, error: 'origin mismatch' }
    const ext = (await resolveEnabled()).find((x) => x.id === extensionId)
    if (!ext) return { ok: false, error: `unknown extension: ${extensionId}` }
    bound.set(wcId, { extId: ext.id, instanceId, tier: ext.tier, capabilities: ext.capabilities })
    // Launch props for a spawned surface — computed BEFORE the host launch so a launch failure can't
    // drop them, and delivered on every return path. ONLY if the guest is genuinely hosted inside that
    // surface's window (embedder check), never by a guessed instanceId (B1).
    const props = surfacePropsForBind(instanceId, e.sender.hostWebContents?.id) ?? {}
    if (ext.nodeEntry) {
      try {
        const host = await launchHost(wcId, ext.id, ext.nodeEntry)
        host.onFrame((msg) => webContents.fromId(wcId)?.send(Channels.extHostFrame, msg))
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), props }
      }
    }
    // (Re)point close-notifications for any surfaces this placement opened, in case it just reloaded
    // (a webview reload rebinds the same {extId, instanceId} under a new wcId).
    repointOwner(ext.id, instanceId, wcId)
    webContents.fromId(wcId)?.send(Channels.extActive, currentActive) // S4: fresh state on bind
    return { ok: true, hasHost: ext.nodeEntry !== undefined, props }
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

  // ── per-placement config (settings) ─────────────────────────────────────────────────────────
  // Key from the BIND-VERIFIED binding (extId + instanceId), never a guest-supplied id — otherwise a
  // widget could read/write another placement's (or another extension's) config. See review B1.
  ipcMain.handle(Channels.extConfig, (e, op: string, value?: unknown, replace?: boolean) => {
    const b = bound.get(e.sender.id)
    if (!b) throw new Error('widget not bound')
    const key = `ext.config.${b.extId}.${b.instanceId}`
    if (op === 'get') return persistence.kvGet(key) ?? {}
    if (op === 'set') {
      const cur = (persistence.kvGet(key) as Record<string, unknown>) ?? {}
      const next = replace ? value : { ...cur, ...((value as Record<string, unknown>) ?? {}) }
      persistence.kvSet(key, next)
      e.sender.send(Channels.extConfigChange, next)
      return next
    }
    return undefined
  })

  // ── floating surface windows ──────────────────────────────────────────────────────────────────
  // A bound guest opens a sibling surface (same package) as a floating window. Gates: bound opener +
  // `windows` capability + the surfaceId must exist in the opener's OWN trusted spec. See
  // docs/floating-surface-windows.md §5.
  ipcMain.handle(Channels.extSurfaceOpen, async (e, surfaceId: string, reqOpts: unknown) => {
    const opener = bound.get(e.sender.id)
    if (!opener) return { ok: false, error: 'not bound' }
    if (opener.tier !== 'full' && !opener.capabilities.includes('windows')) {
      return { ok: false, error: 'missing "windows" capability' }
    }
    if (typeof surfaceId !== 'string') return { ok: false, error: 'bad surfaceId' }
    const ext = (await resolveEnabled()).find((x) => x.id === opener.extId)
    const spec = ext?.spec.surfaces?.[surfaceId]
    if (!spec) return { ok: false, error: `unknown surface: ${surfaceId}` }
    return openSurface(
      {
        opener,
        openerWcId: e.sender.id,
        surfaceId,
        spec,
        uiUrl: `garret://${opener.extId}/~${surfaceId}/`,
        preloadUrl: extPreloadUrl(),
        reqOpts: (reqOpts as SurfaceOpenOpts) ?? {}
      },
      Date.now()
    )
  })
  ipcMain.handle(Channels.extSurfaceClose, (e, instanceId: string) => {
    const opener = bound.get(e.sender.id)
    if (!opener || !surfaceBelongsTo(instanceId, opener.extId)) return false
    return closeSurface(instanceId)
  })
  ipcMain.handle(Channels.extSurfaceFocus, (e, instanceId: string) => {
    const opener = bound.get(e.sender.id)
    if (!opener || !surfaceBelongsTo(instanceId, opener.extId)) return false
    return focusSurface(instanceId)
  })
  // The surface window's OWN root (board app code) fetches its render config, keyed on its top-level
  // wcId (unforgeable) — never a guest-supplied id.
  ipcMain.handle(Channels.extSurfaceInit, (e) => initForWc(e.sender.id))
  // A surface guest shapes its OWN window — scoped to the window that embeds it (e.sender is the guest
  // webview; hostWebContents is its surface window). Board widgets have no surface record → no-op.
  ipcMain.on(Channels.extSurfaceSetAspect, (e, ratio: number) => {
    if (typeof ratio === 'number') setSurfaceAspectRatio(e.sender.hostWebContents?.id, ratio)
  })
  ipcMain.on(Channels.extSurfaceResize, (e, w: number, h: number) => {
    if (typeof w === 'number' && typeof h === 'number') resizeSurface(e.sender.hostWebContents?.id, w, h)
  })
  ipcMain.on(Channels.extSurfaceSelfClose, (e) => closeSurfaceByEmbedder(e.sender.hostWebContents?.id))
  // A board placement was genuinely removed (not just reloaded). Only the app renderer may call this
  // (a garret:// guest may not), so a widget can't close another placement's surfaces. A surface's
  // own root is also non-garret app code, but closeSurfacesForOwner is keyed on {extId, instanceId}
  // and surfaces are same-package, so the worst it can do is close its own ext's siblings.
  ipcMain.on(Channels.extInstanceGone, (e, extId: string, instanceId: string) => {
    if (e.sender.getURL().startsWith('garret:')) return
    if (typeof extId === 'string' && typeof instanceId === 'string') closeSurfacesForOwner(extId, instanceId)
  })

  // ── install / manage ────────────────────────────────────────────────────────────────────────
  ipcMain.handle(Channels.extInstallPlan, (_e, dir: string) => planInstall(dir))
  ipcMain.handle(Channels.extInstallFromFile, (_e, p: string) => planInstallFromFile(p))
  ipcMain.handle(Channels.extInstallCleanup, (_e, dir: string) => cleanupStaging(dir))
  ipcMain.handle(Channels.extInstallCommit, async (_e, plan: ExtInstallPlan) => {
    const res = await commitInstall(plan)
    if (res.ok) {
      await revokeExt(plan.id) // any running host is the OLD code now — tear it down; U3 rebinds
      await syncUiDirs()
    }
    return res
  })
  ipcMain.handle(Channels.extListInstalled, () => listInstalled())
  ipcMain.handle(Channels.extSetEnabled, async (_e, id: string, on: boolean) => {
    const res = await setEnabled(id, on)
    if (res.ok) {
      if (!on) await revokeExt(id) // kill live bindings/hosts so no stale capability ceiling survives
      await syncUiDirs()
    }
    return res
  })
  ipcMain.handle(Channels.extRemove, async (_e, id: string) => {
    await revokeExt(id)
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
