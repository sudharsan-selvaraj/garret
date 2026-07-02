import { join, normalize, sep, extname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { lstat, readdir, readFile, writeFile, rm, mkdir, rename, copyFile } from 'node:fs/promises'
import { app } from 'electron'
import { unpackZip, NATIVE_POLICY } from '@main/sandbox/unpack'
import { recordMacKey, deleteExtSecretKey } from '@main/ext/keys'
import { parseManifest, MANIFEST_FILE, type ExtSpec } from '@main/ext/manifest'
import type { ExtInstallPlan, InstalledExtension, ExtTier } from '@shared/types/ext'

/**
 * The ONE install lifecycle for both tiers. `.garret` is a slip-safe zip; the local record
 * (`.garret-ext.json`) is HMAC-signed (anti-local-tamper, not author auth); code lives under
 * `<userData>/ext/<id>/`, state under `<userData>/ext-data/<id>/` (separate from the hashed code).
 * Web tier installs enabled (one-click, safe); full tier installs DISABLED (consent, default-OFF).
 * See docs/architecture.md § 5 + § Pre-SDK resolutions.
 */

const RECORD_FILE = '.garret-ext.json'
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/

export function extDir(): string {
  return join(app.getPath('userData'), 'ext')
}
export function extDataDir(id: string): string {
  return join(app.getPath('userData'), 'ext-data', id)
}
export async function ensureDataDir(id: string): Promise<string> {
  const dir = extDataDir(id)
  await mkdir(dir, { recursive: true }).catch(() => {})
  return dir
}

export interface ExtRecord {
  id: string
  version: string
  source: string
  sha256: string
  capabilities: string[]
  tier: ExtTier
  enabled: boolean
  installedAt: number
  mac?: string
}

// ── record authentication ──────────────────────────────────────────────────────────────────────
function macPayload(r: ExtRecord): string {
  return JSON.stringify({
    id: r.id,
    version: r.version,
    sha256: r.sha256,
    capabilities: [...r.capabilities].sort(),
    tier: r.tier,
    enabled: r.enabled,
    installedAt: r.installedAt
  })
}
function signRecord(r: ExtRecord): string | null {
  const key = recordMacKey()
  return key ? createHmac('sha256', key).update(macPayload(r)).digest('hex') : null
}
export function recordMacOk(r: ExtRecord): boolean {
  const key = recordMacKey()
  if (!key || !r.mac) return false
  const expected = createHmac('sha256', key).update(macPayload(r)).digest('hex')
  const a = Buffer.from(r.mac, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
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
function recordPath(id: string): string {
  return join(extDir(), id, RECORD_FILE)
}
export async function readRecord(id: string): Promise<ExtRecord | null> {
  try {
    return JSON.parse(await readFile(recordPath(id), 'utf8')) as ExtRecord
  } catch {
    return null
  }
}
let chain: Promise<unknown> = Promise.resolve()
function queue<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => undefined)
  return next as Promise<T>
}
async function writeRecordAtomic(id: string, rec: ExtRecord): Promise<void> {
  const path = recordPath(id)
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(rec, null, 2))
  await rename(tmp, path)
}

function fail(msg: string): ExtInstallPlan {
  return {
    ok: false,
    error: msg,
    id: '',
    name: '',
    version: '',
    source: '',
    capabilities: [],
    tier: 'web',
    isUpdate: false,
    codeChanged: false,
    addedCapabilities: [],
    sourceHash: ''
  }
}

// ── plan / commit ────────────────────────────────────────────────────────────────────────────────
export async function planInstall(srcDir: string): Promise<ExtInstallPlan> {
  const spec = await parseManifest(srcDir)
  if ('error' in spec) return fail(spec.error)
  let sourceHash: string
  try {
    sourceHash = await hashFiles(await collectFiles(srcDir))
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
  const prior = await readRecord(spec.id)
  const priorCaps = new Set(prior?.capabilities ?? [])
  return {
    ok: true,
    id: spec.id,
    name: spec.name,
    description: spec.description,
    version: spec.version,
    source: srcDir,
    capabilities: spec.capabilities,
    tier: spec.tier,
    isUpdate: prior !== null,
    codeChanged: !prior || prior.sha256 !== sourceHash,
    addedCapabilities: spec.capabilities.filter((c) => !priorCaps.has(c)),
    sourceHash
  }
}

export async function commitInstall(plan: ExtInstallPlan): Promise<{ ok: boolean; error?: string }> {
  try {
    const files = await collectFiles(plan.source)
    const hash = await hashFiles(files)
    if (hash !== plan.sourceHash) return { ok: false, error: 'Source changed since consent — aborted' }
    const spec = await parseManifest(plan.source)
    if ('error' in spec) return { ok: false, error: spec.error }

    const prior = await readRecord(spec.id)
    const codeChanged = !prior || prior.sha256 !== hash
    const addedCaps = spec.capabilities.filter((c) => !(prior?.capabilities ?? []).includes(c))
    // Full tier: default OFF, and any code/cap change forces re-consent. Web tier: enabled unless a
    // capability was added (widened access → re-disclose). Carry prior enabled only if authentic.
    let enabled: boolean
    if (!prior) enabled = spec.tier === 'web'
    else if (addedCaps.length > 0 || (spec.tier === 'full' && codeChanged)) enabled = false
    else enabled = recordMacOk(prior) ? prior.enabled : spec.tier === 'web'

    const dest = join(extDir(), spec.id)
    const tmp = join(extDir(), `.tmp-${spec.id}-${randomUUID().slice(0, 8)}`)
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    for (const f of files) {
      const target = join(tmp, f.rel)
      await mkdir(join(target, '..'), { recursive: true })
      await copyFile(f.abs, target)
    }
    const record: ExtRecord = {
      id: spec.id,
      version: spec.version,
      source: plan.source,
      sha256: hash,
      capabilities: spec.capabilities,
      tier: spec.tier,
      enabled,
      installedAt: Date.now()
    }
    record.mac = signRecord(record) ?? undefined
    await writeFile(join(tmp, RECORD_FILE), JSON.stringify(record, null, 2))
    await rm(dest, { recursive: true, force: true })
    await rename(tmp, dest)
    await ensureDataDir(spec.id)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── `.garret` staging ─────────────────────────────────────────────────────────────────────────────
const staging = new Set<string>()
export async function planInstallFromFile(garretPath: string): Promise<ExtInstallPlan> {
  const dir = join(tmpdir(), `garret-ext-${randomUUID()}`)
  try {
    await mkdir(dir, { recursive: true })
    staging.add(dir)
    await unpackZip(garretPath, dir, NATIVE_POLICY)
  } catch (e) {
    await cleanupStaging(dir)
    return fail(e instanceof Error ? e.message : 'Could not open .garret file')
  }
  const plan = await planInstall(dir)
  if (!plan.ok) {
    await cleanupStaging(dir)
    return plan
  }
  plan.staged = true
  return plan
}
export async function cleanupStaging(dir: string): Promise<void> {
  if (!staging.has(dir)) return
  staging.delete(dir)
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

// ── enable / remove / list / resolve ──────────────────────────────────────────────────────────────
export async function setEnabled(id: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!ID_RE.test(id)) return { ok: false, error: 'bad id' }
  return queue(async () => {
    const rec = await readRecord(id)
    if (!rec || rec.id !== id) return { ok: false, error: 'not installed' }
    if (!recordMacOk(rec)) return { ok: false, error: 'Integrity check failed — reinstall this extension' }
    if ((await currentHash(id)) !== rec.sha256) return { ok: false, error: 'Files changed since install — reinstall' }
    const next: ExtRecord = { ...rec, enabled: on }
    const mac = signRecord(next)
    if (!mac) return { ok: false, error: 'Integrity protection unavailable on this platform' }
    next.mac = mac
    await writeRecordAtomic(id, next)
    return { ok: true }
  })
}

export async function removeExtension(id: string): Promise<void> {
  if (!ID_RE.test(id)) return
  deleteExtSecretKey(id) // secret before code/data, so a crash never orphans a decryptable secret
  await rm(join(extDir(), id), { recursive: true, force: true })
  await rm(extDataDir(id), { recursive: true, force: true })
}

export async function listInstalled(): Promise<InstalledExtension[]> {
  let entries: string[]
  try {
    entries = await readdir(extDir())
  } catch {
    return []
  }
  const out: InstalledExtension[] = []
  for (const id of entries) {
    if (!ID_RE.test(id)) continue
    const dir = join(extDir(), id)
    try {
      if (!(await lstat(dir)).isDirectory()) continue
    } catch {
      continue
    }
    const spec = await parseManifest(dir)
    if ('error' in spec || spec.id !== id) continue
    const rec = await readRecord(id)
    if (!rec) continue
    const integrityOk = rec.id === id && recordMacOk(rec)
    const tampered = (await currentHash(id)) !== rec.sha256
    out.push({
      id,
      name: spec.name,
      version: rec.version,
      description: spec.description,
      icon: spec.icon,
      source: rec.source,
      capabilities: rec.capabilities,
      tier: rec.tier,
      enabled: rec.enabled && integrityOk && !tampered,
      tampered,
      integrityOk,
      defaultSize: spec.defaultSize
    })
  }
  return out
}

export interface ResolvedExt {
  id: string
  name: string
  tier: ExtTier
  uiDir: string
  nodeEntry?: string
  capabilities: string[]
  defaultSize?: { w: number; h: number }
  spec: ExtSpec
}

/** The extensions the board may load + run: enabled + authentic + untampered. The only function
 *  the loader/host/broker should trust for execution + the capability ceiling. */
export async function resolveEnabled(): Promise<ResolvedExt[]> {
  const installed = await listInstalled()
  const out: ResolvedExt[] = []
  for (const ext of installed) {
    if (!ext.enabled) continue
    const spec = await parseManifest(join(extDir(), ext.id))
    if ('error' in spec) continue
    out.push({
      id: ext.id,
      name: ext.name,
      tier: ext.tier,
      uiDir: spec.uiDir,
      nodeEntry: spec.nodeEntry,
      capabilities: ext.capabilities,
      defaultSize: ext.defaultSize,
      spec
    })
  }
  return out
}

/** The declared capability ceiling for a running extension (broker reads this, not the manifest). */
export async function capabilitiesOf(id: string): Promise<{ tier: ExtTier; capabilities: string[] } | null> {
  const rec = await readRecord(id)
  if (!rec || !recordMacOk(rec)) return null
  return { tier: rec.tier, capabilities: rec.capabilities }
}
