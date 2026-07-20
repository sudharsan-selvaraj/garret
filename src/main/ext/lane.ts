import { app, ipcMain, session, webContents } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Channels } from '@shared/ipc/channels'
import type { WireMessage } from '@garretapp/sdk'
import type { ExtRuntimeInfo, ExtInstallPlan, InstalledExtension, InstalledPack, PackInstallPlan } from '@shared/types/ext'
import { persistence } from '@main/persistence/store'
import { registerExtProtocol, setUiResolver, resetUiDirs, EXT_PARTITION } from '@main/ext/protocol'
import { launchHost, getHost, killHost } from '@main/ext/host'
import { fetchMarketplaceIndex } from '@main/ext/marketplace'
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
  resolveEnabledWidgetSpecs,
  planPackInstall,
  planPackInstallFromFile,
  planPackInstallFromUrl,
  commitPackInstall,
  cleanupPackStaging,
  listInstalledPacks,
  readPackReadme,
  setPackEnabled,
  removePack,
  readPackRecord,
  readWidgetSettings,
  writeWidgetSettings,
  writeWidgetSecret,
  listWidgetSecretKeys,
  readSharedSettings,
  writeSharedSettings,
  writeSharedSecret,
  listSharedSecretKeys,
  type ResolvedWidget
} from '@main/ext/install'

/**
 * The unified extension lane (main): the renderer↔main↔host relay, the capability-broker IPC, the
 * board loader, and install/manage. One host per placed instance (keyed by the UI webview's
 * webContents id). See docs/guide/03-architecture.md § 2 + § 5.
 */

// webContents id → the extension bound to that widget webview (for the broker + host routing).
const bound = new Map<number, Binding>()

function extPreloadUrl(): string {
  return pathToFileURL(join(app.getAppPath(), 'out', 'preload', 'extBridge.js')).toString()
}

/** The scheme host label for a widget's origin: `garret://<widgetId>.<packId>/`. */
const originHost = (w: ResolvedWidget): string => `${w.widgetId}.${w.packId}`

/** surfaceId → ui dir, for serving `<widget origin>/~<surfaceId>/` (undefined if none). */
function surfaceDirs(w: ResolvedWidget): Record<string, string> | undefined {
  const s = w.widget.surfaces
  if (!s) return undefined
  const out: Record<string, string> = {}
  for (const [sid, spec] of Object.entries(s)) out[sid] = spec.uiDir
  return out
}

export async function syncUiDirs(): Promise<void> {
  resetUiDirs(
    (await resolveEnabledWidgetSpecs()).map((w) => ({
      id: originHost(w),
      dir: w.widget.uiDir,
      surfaces: surfaceDirs(w),
      embed: w.capabilities.includes('embed')
    }))
  )
}

// Map pack shapes onto the EXISTING IPC types so the renderer needs no change: a pack maps to one
// InstalledExtension (id = packId), and a PackInstallPlan to one ExtInstallPlan (union caps).
const toExtPlan = (p: PackInstallPlan): ExtInstallPlan => ({
  ok: p.ok,
  error: p.error,
  id: p.id,
  name: p.name,
  description: p.description,
  version: p.version,
  source: p.source,
  capabilities: p.capabilities,
  hasHost: p.hasHost,
  isUpdate: p.isUpdate,
  sourceHash: p.sourceHash,
  staged: p.staged
})
const toInstalled = (p: InstalledPack): InstalledExtension => ({
  id: p.id,
  name: p.name,
  version: p.version,
  description: p.description,
  icon: p.icon,
  iconData: p.iconData,
  hasReadme: p.hasReadme,
  source: p.source,
  capabilities: p.capabilities,
  hasHost: p.hasHost,
  enabled: p.enabled,
  tampered: p.tampered,
  integrityOk: p.integrityOk
})

let currentActive = true
/** Broadcast board activity to every bound widget (drives useActive / g.active). */
export function broadcastActive(active: boolean): void {
  currentActive = active
  for (const wcId of bound.keys()) webContents.fromId(wcId)?.send(Channels.extActive, active)
}

/** Tear down every live binding + host for a PACK's widgets (on disable / uninstall). */
async function revokePack(packId: string): Promise<void> {
  const rec = await readPackRecord(packId)
  // Close each widget's floating surfaces (owner id = fullId) so no stale capability ceiling survives.
  for (const w of rec?.widgets ?? []) closeSurfacesForExt(w.fullId)
  for (const [wcId, b] of [...bound]) {
    if (b.packId !== packId) continue
    bound.delete(wcId)
    await killHost(wcId)
  }
}

export function registerExtHandlers(): void {
  registerExtProtocol(session.defaultSession.protocol)
  const extSession = session.fromPartition(EXT_PARTITION)
  registerExtProtocol(extSession.protocol)
  // Drop any stale HTTP-cached widget assets (all local garret:// → refetch is instant). Notably
  // evicts a previously long-cached ~theme.css so app-shipped theme updates take effect on launch.
  void extSession.clearCache()
  setUiResolver(async (id) => {
    const w = (await resolveEnabledWidgetSpecs()).find((x) => originHost(x) === id)
    return w ? { dir: w.widget.uiDir, surfaces: surfaceDirs(w), embed: w.capabilities.includes('embed') } : null
  })
  void syncUiDirs()

  // ── board loader — one placeable entry PER WIDGET (packs expand into their widgets) ──────────────
  ipcMain.handle(Channels.extList, async () => ({
    preloadUrl: extPreloadUrl(),
    extensions: (await resolveEnabledWidgetSpecs()).map(
      (w): ExtRuntimeInfo => ({
        id: w.fullId,
        name: w.widget.name,
        uiUrl: w.uiOrigin,
        hasHost: w.widget.nodeEntry !== undefined,
        capabilities: w.capabilities,
        defaultSize: w.widget.defaultSize
      })
    )
  }))

  // ── bind: the widget guest binds ITSELF; we key on e.sender (unforgeable) + verify it is really
  //    running this extension's garret://<id>/ origin. A renderer cannot bind an arbitrary webview
  //    to another extension's capabilities (B2). Launch the host if full tier.
  ipcMain.handle(Channels.extBind, async (e, extensionId: string, instanceId: string) => {
    const wcId = e.sender.id
    // The guest binds with its OWN origin host (`location.hostname` = `<widgetId>.<packId>`), so resolve
    // the widget by that host, then verify the sender's real origin matches (unforgeable).
    const w = (await resolveEnabledWidgetSpecs()).find((x) => originHost(x) === extensionId)
    if (!w) return { ok: false, error: `unknown widget: ${extensionId}` }
    let originOk = false
    try {
      const u = new URL(e.sender.getURL())
      originOk = u.protocol === 'garret:' && u.hostname === originHost(w)
    } catch {
      originOk = false
    }
    if (!originOk) return { ok: false, error: 'origin mismatch' }
    bound.set(wcId, {
      packId: w.packId,
      widgetId: w.widgetId,
      fullId: w.fullId,
      instanceId,
      capabilities: w.capabilities, // this widget's own caps (record-authoritative) — NOT the pack union
      hasShared: w.hasShared // pack opted into a shared store → g.shared.* is available
    })
    // Launch props for a spawned surface — computed BEFORE the host launch so a launch failure can't
    // drop them, and delivered on every return path. ONLY if the guest is genuinely hosted inside that
    // surface's window (embedder check), never by a guessed instanceId (B1).
    const props = surfacePropsForBind(instanceId, e.sender.hostWebContents?.id) ?? {}
    if (w.widget.nodeEntry) {
      try {
        const host = await launchHost(wcId, {
          fullId: w.fullId,
          packId: w.packId,
          widgetId: w.widgetId,
          nodeEntry: w.widget.nodeEntry,
          hasShared: w.hasShared
        })
        host.onFrame((msg) => webContents.fromId(wcId)?.send(Channels.extHostFrame, msg))
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err), props }
      }
    }
    // (Re)point close-notifications for any surfaces this placement opened, in case it just reloaded
    // (a webview reload rebinds the same {fullId, instanceId} under a new wcId).
    repointOwner(w.fullId, instanceId, wcId)
    webContents.fromId(wcId)?.send(Channels.extActive, currentActive) // S4: fresh state on bind
    return { ok: true, hasHost: w.widget.nodeEntry !== undefined, props }
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
    const key = `ext.config.${b.fullId}.${b.instanceId}`
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
    if (!opener.capabilities.includes('windows')) {
      return { ok: false, error: 'missing "windows" capability' }
    }
    if (typeof surfaceId !== 'string') return { ok: false, error: 'bad surfaceId' }
    const w = (await resolveEnabledWidgetSpecs()).find((x) => x.fullId === opener.fullId)
    const spec = w?.widget.surfaces?.[surfaceId]
    if (!spec || !w) return { ok: false, error: `unknown surface: ${surfaceId}` }
    return openSurface(
      {
        opener,
        openerWcId: e.sender.id,
        surfaceId,
        spec,
        uiUrl: `${w.uiOrigin}~${surfaceId}/`, // garret://<widgetId>.<packId>/~<surfaceId>/
        preloadUrl: extPreloadUrl(),
        reqOpts: (reqOpts as SurfaceOpenOpts) ?? {}
      },
      Date.now()
    )
  })
  ipcMain.handle(Channels.extSurfaceClose, (e, instanceId: string) => {
    const opener = bound.get(e.sender.id)
    if (!opener || !surfaceBelongsTo(instanceId, opener.fullId)) return false
    return closeSurface(instanceId)
  })
  ipcMain.handle(Channels.extSurfaceFocus, (e, instanceId: string) => {
    const opener = bound.get(e.sender.id)
    if (!opener || !surfaceBelongsTo(instanceId, opener.fullId)) return false
    return focusSurface(instanceId)
  })
  // The surface window's OWN root (board app code) fetches its render config, keyed on its top-level
  // wcId (unforgeable) — never a guest-supplied id.
  ipcMain.handle(Channels.extSurfaceInit, (e) => initForWc(e.sender.id))
  // A surface guest shapes its OWN window — scoped to the window that embeds it (e.sender is the guest
  // webview; hostWebContents is its surface window). Board widgets have no surface record → no-op.
  ipcMain.on(Channels.extSurfaceSetAspect, (e, ratio: number, inset?: unknown) => {
    if (typeof ratio !== 'number') return
    // Sanitize guest-supplied chrome inset (px, clamped) before it influences window sizing.
    const clampInset = (n: unknown): number => (typeof n === 'number' && n > 0 ? Math.min(n, 2000) : 0)
    const i = inset && typeof inset === 'object' ? (inset as { width?: unknown; height?: unknown }) : {}
    setSurfaceAspectRatio(e.sender.hostWebContents?.id, ratio, {
      width: clampInset(i.width),
      height: clampInset(i.height)
    })
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

  // ── install / manage (pack-based; mapped to the existing IPC shapes) ────────────────────────────
  ipcMain.handle(Channels.extInstallPlan, async (_e, dir: string) => toExtPlan(await planPackInstall(dir)))
  ipcMain.handle(Channels.extInstallFromFile, async (_e, p: string) => toExtPlan(await planPackInstallFromFile(p)))
  ipcMain.handle(Channels.extInstallCleanup, (_e, dir: string) => cleanupPackStaging(dir))
  ipcMain.handle(Channels.extInstallCommit, async (_e, plan: ExtInstallPlan) => {
    // commit re-verifies source+sha itself (the staged dir is unchanged since plan); id = packId.
    const res = await commitPackInstall({ source: plan.source, sourceHash: plan.sourceHash })
    if (res.ok) {
      await revokePack(plan.id) // any running host is the OLD code now — tear it down; U3 rebinds
      await syncUiDirs()
    }
    return res
  })
  ipcMain.handle(Channels.extListInstalled, async () => (await listInstalledPacks()).map(toInstalled))
  ipcMain.handle(Channels.extSetEnabled, async (_e, id: string, on: boolean) => {
    const res = await setPackEnabled(id, on)
    if (res.ok) {
      if (!on) await revokePack(id) // kill live bindings/hosts so no stale capability ceiling survives
      await syncUiDirs()
    }
    return res
  })
  ipcMain.handle(Channels.extRemove, async (_e, id: string) => {
    await revokePack(id)
    await removePack(id)
    await syncUiDirs()
  })

  // ── settings sidebar: per-pack detail + per-widget declarative settings ─────────────────────────
  ipcMain.handle(Channels.extPacks, () => listInstalledPacks())
  ipcMain.handle(Channels.extSettingsGet, (_e, fullId: string) => readWidgetSettings(fullId))
  ipcMain.handle(Channels.extSettingsSet, async (_e, fullId: string, patch: Record<string, unknown>) => {
    await writeWidgetSettings(fullId, patch)
  })
  ipcMain.handle(Channels.extSecretSet, async (_e, fullId: string, key: string, value: string) => {
    await writeWidgetSecret(fullId, key, String(value))
  })
  ipcMain.handle(Channels.extSecretKeys, (_e, fullId: string) => listWidgetSecretKeys(fullId))
  ipcMain.handle(Channels.extSharedGet, (_e, packId: string) => readSharedSettings(packId))
  ipcMain.handle(Channels.extSharedSet, async (_e, packId: string, patch: Record<string, unknown>) => {
    await writeSharedSettings(packId, patch)
  })
  ipcMain.handle(Channels.extSharedSecretSet, async (_e, packId: string, key: string, value: string) => {
    await writeSharedSecret(packId, key, String(value))
  })
  ipcMain.handle(Channels.extSharedSecretKeys, (_e, packId: string) => listSharedSecretKeys(packId))
  // Frame ⋯→Settings for a gx: pack: relay to the guest bound to this placement so it can reveal its
  // own (natively-styled) config panel. Keyed on the bind-verified instanceId, not a guessed id.
  // Generic command bus. Guest declares its ⋯-menu commands → relay to the board renderer (the guest's
  // host wc) keyed on the bind-verified instanceId. User picks one → dispatch back to the guest.
  ipcMain.handle(Channels.extSetCommands, (e, commands: { id: string; label: string }[]) => {
    const b = bound.get(e.sender.id)
    if (!b) return
    const safe = (Array.isArray(commands) ? commands : [])
      .filter((c) => c && typeof c.id === 'string' && typeof c.label === 'string')
      .slice(0, 12)
      .map((c) => ({ id: c.id, label: c.label.slice(0, 40) }))
    e.sender.hostWebContents?.send(Channels.extWidgetCommands, b.instanceId, safe)
  })
  ipcMain.handle(Channels.extRunCommand, (_e, instanceId: string, commandId: string) => {
    for (const [wcId, b] of bound) {
      if (b.instanceId === instanceId) webContents.fromId(wcId)?.send(Channels.extCommand, commandId)
    }
  })
  // A gx: guest sets its own frame title → relay to the board renderer (the guest's host wc) which
  // applies it to that placement's board config. Keyed on the bind-verified instanceId.
  ipcMain.handle(Channels.extSetTitle, (e, title: string) => {
    const b = bound.get(e.sender.id)
    if (b) e.sender.hostWebContents?.send(Channels.extWidgetTitle, b.instanceId, String(title ?? '').slice(0, 120))
  })

  // ── marketplace (GitHub registry index → one-click install) ─────────────────────────────────────
  ipcMain.handle(Channels.extMarketplace, () => fetchMarketplaceIndex())
  // README for the details view: bundled file for an installed pack (`id`), else fetch a marketplace
  // entry's `readme` URL (bounded). Returns markdown text or null.
  ipcMain.handle(Channels.extReadme, async (_e, arg: { id?: string; url?: string }) => {
    if (arg?.url && /^https:\/\//i.test(arg.url)) {
      try {
        const res = await fetch(arg.url)
        if (!res.ok) return null
        return (await res.text()).slice(0, 512 * 1024)
      } catch {
        return null
      }
    }
    return arg?.id ? readPackReadme(arg.id) : null
  })
  ipcMain.handle(Channels.extInstallUrl, async (_e, url: string) => {
    const plan = await planPackInstallFromUrl(url)
    if (!plan.ok) return { ok: false, error: plan.error }
    const res = await commitPackInstall({ source: plan.source, sourceHash: plan.sourceHash })
    await cleanupPackStaging(plan.source)
    if (res.ok) {
      await revokePack(plan.id)
      await syncUiDirs()
    }
    return res
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
