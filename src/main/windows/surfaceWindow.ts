import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, screen, webContents } from 'electron'
import { Channels } from '@shared/ipc/channels'
import type { Binding } from '@main/ext/broker'
import type { SurfaceSpec } from '@main/ext/manifest'
import { EXT_PARTITION } from '@main/ext/protocol'

/**
 * Floating surface windows — a widget opens a sibling surface (same package) as a focusable,
 * resizable OS window. See docs/floating-surface-windows.md. This file owns window lifecycle only;
 * the ext lane owns the security gate (bind + same-package + `windows` cap) and calls in here.
 *
 * NOT a `makePanel` (non-activating) window like the HUD/clipboard picker — a surface must ACTIVATE
 * to take keyboard for interactive control. `alwaysOnTop` at the `floating` level keeps it visible.
 */

const MAX_TOTAL = 32 // global concurrent-surface cap
const MAX_PER_OWNER = 8 // per opening placement
const RATE_MS = 250 // min gap between opens by one owner (anti focus-spam)
const DEFAULT_W = 480
const DEFAULT_H = 640
const MIN_PX = 120
const MAX_PX = 8000

interface SurfaceRecord {
  win: BrowserWindow
  surfaceWcId: number
  extId: string
  surfaceId: string
  instanceId: string // randomUUID — unguessable
  props: Record<string, unknown>
  uiUrl: string // garret://<extId>/~<surfaceId>/
  preloadUrl: string // extBridge, for the inner WidgetSurface
  key?: string // singleton dedup key (per owner+surface)
  ownerExtId: string
  ownerInstanceId: string // the DIRECT opener placement/surface instanceId
  openerWcId: number // where to deliver ext:surface-closed (re-pointed on opener rebind)
}

const MAX_PROPS_BYTES = 256_000

const records = new Map<string, SurfaceRecord>()
const lastOpenAt = new Map<string, number>() // ownerKey → ts, for the open rate limit
const lastFocusAt = new Map<string, number>() // instanceId → ts, throttles focus-steal

const ownerKey = (extId: string, instanceId: string): string => `${extId}:${instanceId}`

function clampPx(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_PX && n <= MAX_PX ? n : fallback
}

/** Guest-supplied open options (all untrusted — validated/clamped in openSurface). */
export interface SurfaceOpenOpts {
  props?: Record<string, unknown>
  title?: string
  size?: { w?: unknown; h?: unknown }
  alwaysOnTop?: unknown
  key?: unknown
}

export interface OpenSurfaceParams {
  opener: Binding
  openerWcId: number
  surfaceId: string
  spec: SurfaceSpec
  uiUrl: string
  preloadUrl: string
  reqOpts: SurfaceOpenOpts
}

export function openSurface(
  p: OpenSurfaceParams,
  now: number
): { ok: true; instanceId: string } | { ok: false; error: string } {
  const oExt = p.opener.extId
  const oInst = p.opener.instanceId
  const key = typeof p.reqOpts.key === 'string' ? p.reqOpts.key : undefined

  // Bound the props payload (held until bind, re-sent on every rebind). Structured clone over IPC
  // already drops __proto__; this only caps size.
  if (p.reqOpts.props !== undefined) {
    let bytes = -1
    try {
      bytes = JSON.stringify(p.reqOpts.props)?.length ?? -1
    } catch {
      return { ok: false, error: 'props not serializable' }
    }
    if (bytes < 0 || bytes > MAX_PROPS_BYTES) return { ok: false, error: 'props too large' }
  }

  // Singleton: a repeat open with the same key focuses the existing window.
  if (key) {
    for (const r of records.values()) {
      if (r.ownerExtId === oExt && r.ownerInstanceId === oInst && r.surfaceId === p.surfaceId && r.key === key) {
        focusSurface(r.instanceId)
        return { ok: true, instanceId: r.instanceId }
      }
    }
  }

  // Limits (anti focus-abuse).
  if (records.size >= MAX_TOTAL) return { ok: false, error: 'too many open windows' }
  let ownerCount = 0
  for (const r of records.values()) if (r.ownerExtId === oExt && r.ownerInstanceId === oInst) ownerCount++
  if (ownerCount >= MAX_PER_OWNER) return { ok: false, error: 'too many windows for this widget' }
  const ok2 = ownerKey(oExt, oInst)
  if (now - (lastOpenAt.get(ok2) ?? 0) < RATE_MS) return { ok: false, error: 'opening windows too fast' }
  lastOpenAt.set(ok2, now)

  const instanceId = randomUUID()
  const width = clampPx(p.reqOpts.size?.w, clampPx(p.spec.defaultSize?.w, DEFAULT_W))
  const height = clampPx(p.reqOpts.size?.h, clampPx(p.spec.defaultSize?.h, DEFAULT_H))
  const minWidth = clampPx(p.spec.minSize?.w, MIN_PX)
  const minHeight = clampPx(p.spec.minSize?.h, MIN_PX)
  const title = String(p.reqOpts.title ?? p.spec.name).slice(0, 200)
  const alwaysOnTop = p.reqOpts.alwaysOnTop !== false // default true

  // Cascade position near the cursor's display so stacked windows don't perfectly overlap.
  const pt = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(pt).workArea
  const off = (ownerCount % 6) * 28
  const x = Math.round(Math.min(area.x + 40 + off, area.x + Math.max(0, area.width - width)))
  const y = Math.round(Math.min(area.y + 40 + off, area.y + Math.max(0, area.height - height)))

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth,
    minHeight,
    title,
    show: false,
    resizable: p.spec.resizable,
    fullscreenable: false,
    frame: p.spec.frame,
    transparent: p.spec.transparent,
    // A transparent surface (e.g. a rounded phone screen) wants no opaque fill or square shadow.
    backgroundColor: p.spec.transparent ? '#00000000' : undefined,
    hasShadow: !p.spec.transparent,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // the root renders a <webview> guest (WidgetSurface); off by default
      additionalArguments: ['--garret-mode=windowed', '--garret-role=surface', `--garret-surface=${instanceId}`]
    }
  })
  win.setAlwaysOnTop(alwaysOnTop, 'floating')
  win.once('ready-to-show', () => win.show())

  const rec: SurfaceRecord = {
    win,
    surfaceWcId: win.webContents.id,
    extId: oExt,
    surfaceId: p.surfaceId,
    instanceId,
    props: p.reqOpts.props && typeof p.reqOpts.props === 'object' ? p.reqOpts.props : {},
    uiUrl: p.uiUrl,
    preloadUrl: p.preloadUrl,
    key,
    ownerExtId: oExt,
    ownerInstanceId: oInst,
    openerWcId: p.openerWcId
  }
  records.set(instanceId, rec)

  // Pin the ONE legitimate guest inside this window: only the intended surface UI, on the ext
  // partition, isolated. This is what makes the props embedder-check (surfacePropsForBind) sound —
  // nothing else can attach here and inherit hostWebContents === surfaceWcId.
  win.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    if (typeof params.src !== 'string' || !params.src.startsWith(rec.uiUrl) || params.partition !== EXT_PARTITION) {
      e.preventDefault()
      return
    }
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })
  // The window shell is trusted app code — it must never navigate away or open popups.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('will-redirect', (e) => e.preventDefault())
  // Don't leak a records slot if the shell fails to load or its renderer dies before the user can
  // close it (would permanently consume a MAX_TOTAL / MAX_PER_OWNER slot).
  win.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
    if (isMainFrame) closeSurface(instanceId)
  })
  win.webContents.on('render-process-gone', () => closeSurface(instanceId))
  win.on('closed', () => onClosed(instanceId))

  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))

  return { ok: true, instanceId }
}

function onClosed(instanceId: string): void {
  const rec = records.get(instanceId)
  if (!rec) return // idempotent (close() → 'closed' + programmatic paths)
  records.delete(instanceId)
  lastFocusAt.delete(instanceId)
  // Cascade: close any surfaces this one opened (chained), then tell the opener it's gone.
  closeSurfacesForOwner(rec.extId, rec.instanceId)
  webContents.fromId(rec.openerWcId)?.send(Channels.extSurfaceClosed, instanceId)
  // Prune the owner's rate-limit entry once it has no surfaces left (bounds lastOpenAt growth).
  const ok = ownerKey(rec.ownerExtId, rec.ownerInstanceId)
  let ownerHasMore = false
  for (const r of records.values()) if (r.ownerExtId === rec.ownerExtId && r.ownerInstanceId === rec.ownerInstanceId) { ownerHasMore = true; break }
  if (!ownerHasMore) lastOpenAt.delete(ok)
}

export function closeSurface(instanceId: string): boolean {
  const rec = records.get(instanceId)
  if (!rec) return false
  if (!rec.win.isDestroyed()) rec.win.close() // → 'closed' → onClosed
  else onClosed(instanceId)
  return true
}

export function focusSurface(instanceId: string): boolean {
  const rec = records.get(instanceId)
  if (!rec || rec.win.isDestroyed()) return false
  // Throttle: a widget spamming open({key}) / focus() must not yank OS focus in a tight loop.
  const now = Date.now()
  if (now - (lastFocusAt.get(instanceId) ?? 0) < RATE_MS) return true
  lastFocusAt.set(instanceId, now)
  if (rec.win.isMinimized()) rec.win.restore()
  rec.win.show()
  rec.win.focus()
  return true
}

/** Render config for the surface window's root (keyed on its OWN top-level wcId — unforgeable). */
export function initForWc(
  surfaceWcId: number
): { extId: string; instanceId: string; uiUrl: string; preloadUrl: string } | null {
  for (const r of records.values()) {
    if (r.surfaceWcId === surfaceWcId) {
      return { extId: r.extId, instanceId: r.instanceId, uiUrl: r.uiUrl, preloadUrl: r.preloadUrl }
    }
  }
  return null
}

/** Props for a binding guest — ONLY if it is really hosted inside that surface's window (B1). */
export function surfacePropsForBind(instanceId: string, embedderWcId: number | undefined): Record<string, unknown> | null {
  const rec = records.get(instanceId)
  if (!rec) return null
  return embedderWcId !== undefined && embedderWcId === rec.surfaceWcId ? rec.props : null
}

/** The surface record whose window hosts this guest webview (the unforgeable embedder), or null. */
function recordByEmbedder(embedderWcId: number | undefined): SurfaceRecord | null {
  if (embedderWcId === undefined) return null
  for (const r of records.values()) if (r.surfaceWcId === embedderWcId) return r
  return null
}

/** A surface shaping its OWN window (embedder-scoped — a guest can only affect the window it's in). */
export function setSurfaceAspectRatio(embedderWcId: number | undefined, ratio: number): void {
  const rec = recordByEmbedder(embedderWcId)
  if (!rec || rec.win.isDestroyed()) return
  rec.win.setAspectRatio(Number.isFinite(ratio) && ratio > 0 ? ratio : 0) // 0 clears the lock
}
export function resizeSurface(embedderWcId: number | undefined, width: number, height: number): void {
  const rec = recordByEmbedder(embedderWcId)
  if (!rec || rec.win.isDestroyed()) return
  const w = clampPx(width, DEFAULT_W)
  const h = clampPx(height, DEFAULT_H)
  rec.win.setSize(w, h)
}

/** True if `instanceId` is a live surface belonging to `extId` (authorizes close/focus by a sibling). */
export function surfaceBelongsTo(instanceId: string, extId: string): boolean {
  return records.get(instanceId)?.extId === extId
}

/** Re-point close-notifications when an owner placement rebinds (reload → new wcId). */
export function repointOwner(extId: string, ownerInstanceId: string, newOpenerWcId: number): void {
  for (const r of records.values()) {
    if (r.ownerExtId === extId && r.ownerInstanceId === ownerInstanceId) r.openerWcId = newOpenerWcId
  }
}

/** Close every surface opened by a placement/surface (its direct children; cascade via onClosed). */
export function closeSurfacesForOwner(extId: string, ownerInstanceId: string): void {
  for (const r of [...records.values()]) {
    if (r.ownerExtId === extId && r.ownerInstanceId === ownerInstanceId) closeSurface(r.instanceId)
  }
}

/** Close every surface belonging to an extension (on disable / uninstall). */
export function closeSurfacesForExt(extId: string): void {
  for (const r of [...records.values()]) if (r.extId === extId) closeSurface(r.instanceId)
}
