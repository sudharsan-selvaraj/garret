import { join, normalize, sep, extname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstat, readdir, readFile, writeFile, rm, mkdir, rename, copyFile } from 'node:fs/promises'
import { app } from 'electron'
import { unpackZip, NATIVE_POLICY } from '@main/ext/unpack'
import { recordMacKey, deleteExtSecretKey } from '@main/ext/keys'
import { setSecret, secretKeys } from '@main/ext/secrets'
import { parsePack, MANIFEST_FILE, type PackSpec, type WidgetSpec } from '@main/ext/manifest'
import type {
  PackRecord,
  PackInstallPlan,
  PackSourceKind,
  InstalledPack,
  WidgetMeta
} from '@shared/types/ext'

/**
 * The ONE install lifecycle for both tiers. `.garret` is a slip-safe zip; the local record
 * (`.garret-ext.json`) is HMAC-signed (anti-local-tamper, not author auth); code lives under
 * `<userData>/ext/<id>/`, state under `<userData>/ext-data/<id>/` (separate from the hashed code).
 * Web tier installs enabled (one-click, safe); full tier installs DISABLED (consent, default-OFF).
 * See docs/guide/03-architecture.md § 5 + § Pre-SDK resolutions.
 */

const RECORD_FILE = '.garret-ext.json'

function extDir(): string {
  return join(app.getPath('userData'), 'ext')
}
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PACK storage. Layout:
//   code:  <userData>/ext/<packId>/            (RECORD_FILE at root; whole pack unpacked once)
//   state: <userData>/ext-data/<packId>/<widgetId>/   + /_shared/ (opt-in pack-shared)
// packId is a single dir segment (dotted, no "/"), widgetId a single segment — validated before use.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const PACK_ID_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/
const WIDGET_ID_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

function packDir(packId: string): string {
  return join(extDir(), packId)
}
export function widgetDataDir(packId: string, widgetId: string): string {
  return join(app.getPath('userData'), 'ext-data', packId, widgetId)
}
export function sharedDataDir(packId: string): string {
  return join(app.getPath('userData'), 'ext-data', packId, '_shared')
}
export async function ensureWidgetDataDir(packId: string, widgetId: string): Promise<string> {
  if (!PACK_ID_RE.test(packId) || !WIDGET_ID_RE.test(widgetId)) throw new Error('bad pack/widget id')
  const dir = widgetDataDir(packId, widgetId)
  await mkdir(dir, { recursive: true }).catch(() => {})
  return dir
}
export async function ensureSharedDataDir(packId: string): Promise<string> {
  if (!PACK_ID_RE.test(packId)) throw new Error('bad pack id')
  const dir = sharedDataDir(packId)
  await mkdir(dir, { recursive: true }).catch(() => {})
  return dir
}

// Declarative settings persist as keys in the widget's OWN storage.json — the same store the widget
// reads via `g.storage`/`ctx.storage`. So the settings sidebar just edits those keys; the widget picks
// them up (on next read/reload). `fullId` = `<packId>/<widgetId>`.
function splitFullId(fullId: string): { packId: string; widgetId: string } | null {
  const i = fullId.indexOf('/')
  if (i < 0) return null
  const packId = fullId.slice(0, i)
  const widgetId = fullId.slice(i + 1)
  return PACK_ID_RE.test(packId) && WIDGET_ID_RE.test(widgetId) ? { packId, widgetId } : null
}
export async function readWidgetSettings(fullId: string): Promise<Record<string, unknown>> {
  const p = splitFullId(fullId)
  if (!p) return {}
  try {
    return JSON.parse(await readFile(join(widgetDataDir(p.packId, p.widgetId), 'storage.json'), 'utf8'))
  } catch {
    return {}
  }
}
export async function writeWidgetSettings(fullId: string, patch: Record<string, unknown>): Promise<void> {
  const p = splitFullId(fullId)
  if (!p) return
  const dir = await ensureWidgetDataDir(p.packId, p.widgetId)
  const file = join(dir, 'storage.json')
  let cur: Record<string, unknown> = {}
  try {
    cur = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    /* fresh */
  }
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify({ ...cur, ...patch }))
  await rename(tmp, file)
}

// A `type:"secret"` settings field lands in the widget's ENCRYPTED secrets store (not plaintext
// storage.json) — the same store the widget reads via `g.secrets.get(key)`. We never hand the
// plaintext back to the UI; the settings pane only learns which keys are set (listWidgetSecretKeys).
export async function writeWidgetSecret(fullId: string, key: string, value: string): Promise<void> {
  const p = splitFullId(fullId)
  if (!p) return
  const dir = await ensureWidgetDataDir(p.packId, p.widgetId)
  setSecret(dir, fullId, key, value)
}
export async function listWidgetSecretKeys(fullId: string): Promise<string[]> {
  const p = splitFullId(fullId)
  if (!p) return []
  return secretKeys(widgetDataDir(p.packId, p.widgetId))
}

// Pack-shared settings (the `shared` schema) — one credential/config set the whole pack sees. Same
// split as per-widget: non-secret → shared storage.json, `type:"secret"` → shared encrypted store.
export async function readSharedSettings(packId: string): Promise<Record<string, unknown>> {
  if (!PACK_ID_RE.test(packId)) return {}
  try {
    return JSON.parse(await readFile(join(sharedDataDir(packId), 'storage.json'), 'utf8'))
  } catch {
    return {}
  }
}
export async function writeSharedSettings(packId: string, patch: Record<string, unknown>): Promise<void> {
  if (!PACK_ID_RE.test(packId)) return
  const dir = await ensureSharedDataDir(packId)
  const file = join(dir, 'storage.json')
  let cur: Record<string, unknown> = {}
  try {
    cur = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    /* fresh */
  }
  const tmp = `${file}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify({ ...cur, ...patch }))
  await rename(tmp, file)
}
export async function writeSharedSecret(packId: string, key: string, value: string): Promise<void> {
  if (!PACK_ID_RE.test(packId)) return
  const dir = await ensureSharedDataDir(packId)
  setSecret(dir, `${packId}/_shared`, key, value)
}
export async function listSharedSecretKeys(packId: string): Promise<string[]> {
  if (!PACK_ID_RE.test(packId)) return []
  return secretKeys(sharedDataDir(packId))
}

// Pack record: HMAC anti-tamper. The signed payload binds each widget's host+caps so a local edit
// can't silently re-scope a widget.
function packMacPayload(r: PackRecord): string {
  return JSON.stringify({
    id: r.id,
    publisher: r.publisher,
    version: r.version,
    sha256: r.sha256,
    capabilities: [...r.capabilities].sort(),
    enabled: r.enabled,
    installedAt: r.installedAt,
    bundled: !!r.bundled,
    widgets: [...r.widgets]
      .map((w) => ({ fullId: w.fullId, hasHost: w.hasHost, capabilities: [...w.capabilities].sort() }))
      .sort((a, b) => a.fullId.localeCompare(b.fullId))
  })
}
function signPackRecord(r: PackRecord): string | null {
  const key = recordMacKey()
  return key ? createHmac('sha256', key).update(packMacPayload(r)).digest('hex') : null
}
function packRecordMacOk(r: PackRecord): boolean {
  const key = recordMacKey()
  if (!key || !r.mac) return false
  const expected = createHmac('sha256', key).update(packMacPayload(r)).digest('hex')
  const a = Buffer.from(r.mac, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
function packRecordPath(packId: string): string {
  return join(packDir(packId), RECORD_FILE)
}
export async function readPackRecord(packId: string): Promise<PackRecord | null> {
  if (!PACK_ID_RE.test(packId)) return null
  try {
    return JSON.parse(await readFile(packRecordPath(packId), 'utf8')) as PackRecord
  } catch {
    return null
  }
}
async function writePackRecordAtomic(packId: string, rec: PackRecord): Promise<void> {
  const path = packRecordPath(packId)
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(rec, null, 2))
  await rename(tmp, path)
}

// ── file collection + hashing (every file; reject symlink/.node; skip our record) ────────────────
async function collectFiles(srcDir: string): Promise<{ rel: string; abs: string }[]> {
  const root = normalize(srcDir)
  const out: { rel: string; abs: string }[] = []
  let bytes = 0
  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const abs = join(dir, name)
      const rel = relative(root, abs).split(sep).join('/')
      if (rel === RECORD_FILE) continue
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path escapes source: ${name}`)
      const st = await lstat(abs)
      if (st.isSymbolicLink()) throw new Error(`symlinks not allowed: ${name}`)
      if (st.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!st.isFile()) continue
      if (extname(abs).toLowerCase() === '.node') throw new Error(`native addons (.node) not allowed: ${name}`)
      bytes += st.size
      if (bytes > NATIVE_POLICY.maxBytes) throw new Error('extension exceeds size limit')
      out.push({ rel, abs })
      if (out.length > NATIVE_POLICY.maxFiles) throw new Error('extension has too many files')
    }
  }
  await walk(root)
  if (!out.some((f) => f.rel === MANIFEST_FILE)) throw new Error(`missing ${MANIFEST_FILE}`)
  return out
}
async function hashFiles(files: { rel: string; abs: string }[]): Promise<string> {
  const map: Record<string, string> = {}
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    map[f.rel] = createHash('sha256').update(await readFile(f.abs)).digest('hex')
  }
  return createHash('sha256').update(JSON.stringify(map)).digest('hex')
}
async function currentHash(id: string): Promise<string | null> {
  try {
    return await hashFiles(await collectFiles(join(extDir(), id)))
  } catch {
    return null
  }
}

// ── record I/O (serialized + atomic) ────────────────────────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve()
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next as Promise<T>
}
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PACK install flow — plan / commit / list / resolve, per pack + per widget.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** A widget's own origin — widgetId is the FIRST host label (has no dots), packId the rest, so
 *  `host.split('.', 1)` resolves it unambiguously. Per-widget origin ⇒ per-widget storage partition. */
const widgetOrigin = (packId: string, widgetId: string): string => `garret://${widgetId}.${packId}/`

const widgetMetaFrom = (spec: PackSpec): WidgetMeta[] =>
  spec.widgets.map((w) => ({
    id: w.id,
    fullId: w.fullId,
    name: w.name,
    capabilities: w.capabilities,
    hasHost: w.nodeEntry !== undefined,
    defaultSize: w.defaultSize
  }))

const packHasHost = (spec: PackSpec): boolean => spec.widgets.some((w) => w.nodeEntry !== undefined)

function failPack(msg: string): PackInstallPlan {
  return {
    ok: false,
    error: msg,
    id: '',
    publisher: '',
    name: '',
    version: '',
    source: '',
    sourceKind: 'local',
    hasHost: false,
    capabilities: [],
    widgets: [],
    isUpdate: false,
    sourceHash: ''
  }
}

export async function planPackInstall(srcDir: string, sourceKind: PackSourceKind = 'local'): Promise<PackInstallPlan> {
  const spec = await parsePack(srcDir)
  if ('error' in spec) return failPack(spec.error)
  let sourceHash: string
  try {
    sourceHash = await hashFiles(await collectFiles(srcDir))
  } catch (e) {
    return failPack(e instanceof Error ? e.message : String(e))
  }
  const prior = await readPackRecord(spec.id)
  return {
    ok: true,
    id: spec.id,
    publisher: spec.publisher,
    name: spec.name,
    description: spec.description,
    version: spec.version,
    source: srcDir,
    sourceKind,
    hasHost: packHasHost(spec),
    capabilities: spec.capabilities,
    widgets: widgetMetaFrom(spec),
    isUpdate: prior !== null,
    sourceHash
  }
}

export async function commitPackInstall(
  plan: { source: string; sourceHash: string },
  opts?: { bundled?: boolean }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const files = await collectFiles(plan.source)
    const hash = await hashFiles(files)
    if (hash !== plan.sourceHash) return { ok: false, error: 'Source changed since consent — aborted' }
    const spec = await parsePack(plan.source)
    if ('error' in spec) return { ok: false, error: spec.error }

    const prior = await readPackRecord(spec.id)
    // No consent/tiers: install is one-click → enabled. On reinstall keep the prior enabled state if
    // the record is authentic (a user who disabled it stays disabled); default enabled otherwise.
    const enabled = prior && packRecordMacOk(prior) ? prior.enabled : true
    const bundled = opts?.bundled ?? prior?.bundled ?? false

    const dest = packDir(spec.id)
    const tmp = join(extDir(), `.tmp-${spec.id}-${randomUUID().slice(0, 8)}`)
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    for (const f of files) {
      const target = join(tmp, f.rel)
      await mkdir(join(target, '..'), { recursive: true })
      await copyFile(f.abs, target)
    }
    const record: PackRecord = {
      id: spec.id,
      publisher: spec.publisher,
      version: spec.version,
      source: plan.source,
      sha256: hash,
      capabilities: spec.capabilities,
      enabled,
      installedAt: Date.now(),
      bundled,
      widgets: widgetMetaFrom(spec)
    }
    record.mac = signPackRecord(record) ?? undefined
    await writeFile(join(tmp, RECORD_FILE), JSON.stringify(record, null, 2))
    await rm(dest, { recursive: true, force: true })
    await rename(tmp, dest)
    for (const w of spec.widgets) await ensureWidgetDataDir(spec.id, w.id)
    if (spec.shared) await ensureSharedDataDir(spec.id)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const packStaging = new Set<string>()
export async function planPackInstallFromFile(
  garretPath: string,
  sourceKind: PackSourceKind = 'local'
): Promise<PackInstallPlan> {
  const dir = join(tmpdir(), `garret-pack-${randomUUID()}`)
  try {
    await mkdir(dir, { recursive: true })
    packStaging.add(dir)
    await unpackZip(garretPath, dir, NATIVE_POLICY)
  } catch (e) {
    await cleanupPackStaging(dir)
    return failPack(e instanceof Error ? e.message : 'Could not open .garret file')
  }
  const plan = await planPackInstall(dir, sourceKind)
  if (!plan.ok) {
    await cleanupPackStaging(dir)
    return plan
  }
  plan.staged = true
  return plan
}
export async function cleanupPackStaging(dir: string): Promise<void> {
  if (!packStaging.has(dir)) return
  packStaging.delete(dir)
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

// Marketplace / git install: download a prebuilt `.garret` over HTTPS, then run the SAME verify
// pipeline (slip-safe unzip → parse → plan → commit). No build, no scripts — just fetch + verify.
const MAX_PACK_BYTES = 64 * 1024 * 1024 // 64 MB cap on a downloaded pack
export async function planPackInstallFromUrl(
  url: string,
  sourceKind: PackSourceKind = 'registry'
): Promise<PackInstallPlan> {
  if (!/^https:\/\//i.test(url)) return failPack('Only https:// pack URLs are allowed')
  const tmpFile = join(tmpdir(), `garret-dl-${randomUUID()}.garret`)
  try {
    const res = await fetch(url)
    if (!res.ok) return failPack(`Download failed: HTTP ${res.status}`)
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_PACK_BYTES) return failPack('Pack exceeds the size limit')
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_PACK_BYTES) return failPack('Pack exceeds the size limit')
    await writeFile(tmpFile, bytes)
  } catch (e) {
    await rm(tmpFile, { force: true }).catch(() => {})
    return failPack(e instanceof Error ? e.message : 'Download failed')
  }
  try {
    return await planPackInstallFromFile(tmpFile, sourceKind)
  } finally {
    await rm(tmpFile, { force: true }).catch(() => {})
  }
}

export async function setPackEnabled(packId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!PACK_ID_RE.test(packId)) return { ok: false, error: 'bad id' }
  return queue(async () => {
    const rec = await readPackRecord(packId)
    if (!rec || rec.id !== packId) return { ok: false, error: 'not installed' }
    if (!packRecordMacOk(rec)) return { ok: false, error: 'Integrity check failed — reinstall this pack' }
    if ((await currentHash(packId)) !== rec.sha256) return { ok: false, error: 'Files changed since install — reinstall' }
    const next: PackRecord = { ...rec, enabled: on }
    const mac = signPackRecord(next)
    if (!mac) return { ok: false, error: 'Integrity protection unavailable on this platform' }
    next.mac = mac
    await writePackRecordAtomic(packId, next)
    return { ok: true }
  })
}

export async function removePack(packId: string): Promise<void> {
  if (!PACK_ID_RE.test(packId)) return
  const rec = await readPackRecord(packId)
  if (rec?.bundled) return // bundled packs ship with the app + auto-reinstall — non-removable
  // Secret keys (per widget + shared) before code/data, so a crash never orphans a decryptable secret.
  if (rec) {
    for (const w of rec.widgets) deleteExtSecretKey(w.fullId)
    deleteExtSecretKey(`${packId}/_shared`)
  }
  await rm(packDir(packId), { recursive: true, force: true })
  await rm(join(app.getPath('userData'), 'ext-data', packId), { recursive: true, force: true })
}

// ── pack assets: icon (→ data URL) + README (→ text), traversal-guarded ─────────────────────────
const ICON_MAX = 512 * 1024
const README_MAX = 512 * 1024
const README_NAMES = ['README.md', 'readme.md', 'Readme.md']
const ICON_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** Resolve a pack-relative asset path, refusing anything that escapes the pack dir. */
function packAssetPath(packId: string, rel: string): string | null {
  if (!rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) return null
  const base = packDir(packId)
  const p = normalize(join(base, rel))
  return p === base || p.startsWith(base + sep) ? p : null
}

/** The pack's icon as a data URL (from spec.icon), or undefined. */
async function packIconDataUrl(packId: string, iconRel: string | undefined): Promise<string | undefined> {
  if (!iconRel) return undefined
  const p = packAssetPath(packId, iconRel)
  const mime = p && ICON_MIME[extname(p).toLowerCase()]
  if (!p || !mime) return undefined
  try {
    const buf = await readFile(p)
    return buf.length > ICON_MAX ? undefined : `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/** The pack's README path (spec.readme, else a README.md at the root), or null. */
async function packReadmePath(packId: string, readmeRel: string | undefined): Promise<string | null> {
  for (const c of readmeRel ? [readmeRel] : README_NAMES) {
    const p = packAssetPath(packId, c)
    if (p) {
      try {
        await lstat(p)
        return p
      } catch {
        /* next candidate */
      }
    }
  }
  return null
}

/** Read an installed pack's bundled README markdown (bounded), or null. */
export async function readPackReadme(packId: string): Promise<string | null> {
  if (!PACK_ID_RE.test(packId)) return null
  const spec = await parsePack(packDir(packId))
  if ('error' in spec) return null
  const p = await packReadmePath(packId, spec.readme)
  if (!p) return null
  try {
    return (await readFile(p, 'utf8')).slice(0, README_MAX)
  } catch {
    return null
  }
}

export async function listInstalledPacks(): Promise<InstalledPack[]> {
  let entries: string[]
  try {
    entries = await readdir(extDir())
  } catch {
    return []
  }
  const out: InstalledPack[] = []
  for (const packId of entries) {
    if (!PACK_ID_RE.test(packId)) continue
    const dir = packDir(packId)
    try {
      if (!(await lstat(dir)).isDirectory()) continue
    } catch {
      continue
    }
    const spec = await parsePack(dir)
    if ('error' in spec || spec.id !== packId) continue
    const rec = await readPackRecord(packId)
    if (!rec) continue
    const integrityOk = rec.id === packId && packRecordMacOk(rec)
    const tampered = (await currentHash(packId)) !== rec.sha256
    const iconData = await packIconDataUrl(packId, spec.icon)
    const hasReadme = (await packReadmePath(packId, spec.readme)) !== null
    out.push({
      id: packId,
      publisher: spec.publisher,
      name: spec.name,
      version: rec.version,
      description: spec.description,
      icon: spec.icon,
      iconData,
      hasReadme,
      source: rec.source,
      hasHost: rec.widgets.some((w) => w.hasHost),
      capabilities: rec.capabilities,
      enabled: rec.enabled && integrityOk && !tampered,
      tampered,
      integrityOk,
      widgets: spec.widgets.map((w) => ({
        fullId: w.fullId,
        id: w.id,
        name: w.name,
        hasHost: w.nodeEntry !== undefined,
        capabilities: rec.widgets.find((x) => x.id === w.id)?.capabilities ?? w.capabilities,
        defaultSize: w.defaultSize,
        settingsSchema: w.settingsSchema
      })),
      sharedSettingsSchema: spec.shared?.settingsSchema
    })
  }
  return out
}

/** A widget of an enabled pack, WITH its full main-side spec (surfaces etc.) — the internal shape the
 *  lane needs for the scheme + surface-open. `capabilities` is record-authoritative. */
export interface ResolvedWidget {
  packId: string
  fullId: string
  widgetId: string
  uiOrigin: string
  hasShared: boolean
  capabilities: string[]
  widget: WidgetSpec
}

export async function resolveEnabledWidgetSpecs(): Promise<ResolvedWidget[]> {
  const packs = await listInstalledPacks()
  const out: ResolvedWidget[] = []
  for (const pack of packs) {
    if (!pack.enabled) continue
    const spec = await parsePack(packDir(pack.id))
    if ('error' in spec) continue
    const rec = await readPackRecord(pack.id)
    if (!rec) continue
    const hasShared = spec.shared !== undefined
    for (const w of spec.widgets) {
      out.push({
        packId: pack.id,
        fullId: w.fullId,
        widgetId: w.id,
        uiOrigin: widgetOrigin(pack.id, w.id),
        hasShared,
        capabilities: rec.widgets.find((x) => x.id === w.id)?.capabilities ?? w.capabilities,
        widget: w
      })
    }
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Bundled packs — .garret files shipped with the app (clock, web-view, …), auto-installed on first
// run + kept current on app update, and marked non-removable. Prod: <resources>/packs; dev: repo.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function bundledPacksDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'packs') : join(app.getAppPath(), 'resources', 'packs')
}

/** Install/refresh every bundled `.garret` (idempotent: skips one already installed at the same hash).
 *  Best-effort per pack; a bad bundled pack never blocks startup. Call once after the ext lane inits. */
export async function installBundledPacks(): Promise<void> {
  let files: string[] = []
  try {
    files = (await readdir(bundledPacksDir())).filter((f) => f.endsWith('.garret'))
  } catch {
    /* no bundled packs dir (dev before any are added) — still reconcile below */
  }
  const shipped = new Set<string>()
  for (const f of files) {
    const plan = await planPackInstallFromFile(join(bundledPacksDir(), f))
    if (!plan.ok) continue
    shipped.add(plan.id)
    try {
      const prior = await readPackRecord(plan.id)
      if (!prior || prior.sha256 !== plan.sourceHash) {
        await commitPackInstall({ source: plan.source, sourceHash: plan.sourceHash }, { bundled: true })
      }
    } finally {
      await cleanupPackStaging(plan.source)
    }
  }
  // Reconcile: a pack previously bundled but no longer shipped (removed from the bundled dir) becomes
  // a normal, user-managed pack — keep its code/data, just drop the non-removable `bundled` flag so
  // the user can disable/remove it. Re-sign since `bundled` is in the record MAC.
  for (const p of await listInstalledPacks()) {
    if (shipped.has(p.id)) continue
    const rec = await readPackRecord(p.id)
    if (!rec?.bundled) continue
    rec.bundled = false
    rec.mac = signPackRecord(rec) ?? undefined
    await writePackRecordAtomic(p.id, rec)
  }
}
