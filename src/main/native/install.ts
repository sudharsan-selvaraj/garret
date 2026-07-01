import { join, normalize, sep, extname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, createHmac, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstat, readdir, readFile, writeFile, rm, mkdir, rename, copyFile } from 'node:fs/promises'
import { app } from 'electron'
import { secrets } from '@main/persistence/secrets'
import { unpackZip, NATIVE_POLICY } from '@main/sandbox/unpack'
import type { NativeInstallPlan, InstalledExtension, NativeDeclared } from '@shared/types/native'

/**
 * Install lifecycle for NATIVE (full-access) extensions. Mirrors the hardened sandbox installer
 * (`src/main/sandbox/install.ts`) but with the deltas a raw-Node entry point forces
 * (docs/native-phase3-design.md rev 2, critic-hardened):
 *
 *  - separate root (`<userData>/extensions/<id>/`) so a native `.node` can never land where the
 *    sandbox loader would serve it, and no cross-tier id collision;
 *  - the integrity hash covers EVERY regular file in the tree (not just served web-asset types,
 *    and NOT skipping dotfiles) — a raw-Node host can `require('./x')` / read `.payload`, so a
 *    file the sandbox walk would skip is invisible post-consent tampering (critic B2);
 *  - the host-written record is HMAC-signed with a key in safeStorage; the loader honors
 *    `enabled` only if the MAC verifies AND record.id === dirname AND the on-disk files still
 *    hash to record.sha256 (critic B1). `userData` is writable, so an unauthenticated `enabled`
 *    boolean is exactly the attack the trust model must stop;
 *  - `enabled` is hard-coded FALSE on fresh install; any code change on update resets it to
 *    false → full re-consent (benign-v1→malicious-v2 defense);
 *  - if safeStorage is unavailable we FAIL CLOSED (never a plaintext key — that's zero mitigation
 *    against the file-write attacker the MAC defends against).
 *
 * `declared` (binaries/network) is disclosure only — there is NO enforced permission ceiling.
 */

const SUPPORTED_API_VERSION = 1
const RECORD_FILE = '.garret-ext.json'
/** Leading alphanumeric, lowercase; no `/`, no `..`/leading-dot path forms. */
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const MAX_BYTES = 100 * 1024 * 1024
const MAX_FILES = 4000
const KEY_SECRET = 'nativeExtRecordKey'

/** <userData>/extensions/<id>/… — a DIFFERENT root from the sandbox `widgets/` tree. */
export function nativeExtensionsDir(): string {
  return join(app.getPath('userData'), 'extensions')
}

interface DiskManifest {
  kind?: unknown
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  apiVersion?: unknown
  node?: unknown
  ui?: unknown
  binaries?: unknown
  network?: unknown
  defaultSize?: unknown
}

/** The host-written, HMAC-signed record. `mac` authenticates the whole thing (esp. `enabled`). */
export interface ExtRecord {
  id: string
  version: string
  source: string
  sha256: string
  declared: NativeDeclared
  enabled: boolean
  installedAt: number
  /** HMAC-SHA256 over the canonical payload (see macPayload). Absent/invalid → treated disabled. */
  mac?: string
}

interface ManifestSpec {
  id: string
  name: string
  description?: string
  version: string
  /** Absolute path to the raw-Node host entry (contained under the extension dir). */
  nodeEntry: string
  /** Absolute path to the UI dir (contains index.html; contained under the extension dir). */
  uiDir: string
  declared: NativeDeclared
  defaultSize?: { w: number; h: number }
}

function fail(msg: string): NativeInstallPlan {
  return {
    ok: false,
    error: msg,
    id: '',
    name: '',
    version: '',
    source: '',
    declared: { binaries: [], network: [] },
    isUpdate: false,
    codeChanged: false,
    sourceHash: ''
  }
}

// ---- record authentication (guards the enable flag) --------------------------------------------

/**
 * The HMAC key, held in safeStorage (Keychain-backed). Created on first use. Returns null when
 * safeStorage is unavailable — callers MUST fail closed (never fall back to a plaintext key: a
 * key file in userData is readable by the exact file-write attacker the MAC defends against).
 */
function macKey(): Buffer | null {
  if (!secrets.available()) return null
  let hex = secrets.get(KEY_SECRET)
  if (!hex) {
    hex = randomBytes(32).toString('hex')
    secrets.set(KEY_SECRET, hex)
  }
  return Buffer.from(hex, 'hex')
}

/** Canonical, order-fixed payload the MAC covers. Binds identity so a record isn't portable. */
function macPayload(r: ExtRecord): string {
  return JSON.stringify({
    id: r.id,
    version: r.version,
    sha256: r.sha256,
    enabled: r.enabled,
    installedAt: r.installedAt
  })
}

function signRecord(r: ExtRecord): string | null {
  const key = macKey()
  if (!key) return null
  return createHmac('sha256', key).update(macPayload(r)).digest('hex')
}

/** True iff the record's MAC verifies (authentic — not forged/hand-edited in userData). */
export function recordMacOk(r: ExtRecord): boolean {
  const key = macKey()
  if (!key || !r.mac) return false
  const expected = createHmac('sha256', key).update(macPayload(r)).digest('hex')
  const a = Buffer.from(r.mac, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---- file collection + hashing (every file, not just served types) -----------------------------

/**
 * Collect installable files, hashing EVERY regular file (dotfiles included — a raw-Node host can
 * read them at runtime) except our own record file. Reject symlinks and `.node`. Throws on any
 * violation or if the cap is exceeded.
 */
async function collectFiles(srcDir: string): Promise<{ rel: string; abs: string }[]> {
  const root = normalize(srcDir)
  const out: { rel: string; abs: string }[] = []
  let bytes = 0

  async function walk(dir: string): Promise<void> {
    for (const name of await readdir(dir)) {
      const abs = join(dir, name)
      const rel = relative(root, abs).split(sep).join('/')
      if (rel === RECORD_FILE) continue // our host-written record — written separately, not hashed
      // Containment: never escape the source root.
      if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path escapes source: ${name}`)
      // lstat (do NOT follow) so a symlink can't smuggle in an outside file.
      const st = await lstat(abs)
      if (st.isSymbolicLink()) throw new Error(`symlinks not allowed: ${name}`)
      if (st.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!st.isFile()) continue // skip sockets/fifos/etc
      // `.node` rejected for ABI/packaging reasons (design §9) — NOT a security boundary.
      if (extname(abs).toLowerCase() === '.node') throw new Error(`native addons (.node) not allowed: ${name}`)
      bytes += st.size
      if (bytes > MAX_BYTES) throw new Error('extension exceeds 100MB')
      out.push({ rel, abs })
      if (out.length > MAX_FILES) throw new Error('extension has too many files (>4000)')
    }
  }

  await walk(root)
  if (!out.some((f) => f.rel === 'manifest.json')) throw new Error('missing manifest.json')
  return out
}

/** Stable integrity hash: sha256 of JSON{ relpath: sha256hex(file) } with sorted keys. */
async function hashFiles(files: { rel: string; abs: string }[]): Promise<string> {
  const map: Record<string, string> = {}
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    map[f.rel] = createHash('sha256').update(await readFile(f.abs)).digest('hex')
  }
  return createHash('sha256').update(JSON.stringify(map)).digest('hex')
}

/** Re-hash an installed extension's files and compare to the recorded sha256. */
async function currentHash(id: string): Promise<string | null> {
  try {
    return await hashFiles(await collectFiles(join(nativeExtensionsDir(), id)))
  } catch {
    return null
  }
}

// ---- manifest parsing -------------------------------------------------------------------------

/** Validate a manifest-relative path is contained under `base` (no absolute, no `..`). */
function containedPath(base: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) return null
  const p = normalize(join(base, rel))
  return p === base || p.startsWith(base + sep) ? p : null
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Parse + validate a source manifest into the trusted spec. Single source of truth for identity,
 * the resolved node/ui paths, and the declared disclosure — used by planInstall, commitInstall
 * (after the hash check), and the loader. `kind` MUST be "extension" (routes native vs sandbox).
 */
async function parseManifestSpec(srcDir: string): Promise<ManifestSpec | { error: string }> {
  const base = normalize(srcDir)
  let manifest: DiskManifest
  try {
    manifest = JSON.parse(await readFile(join(base, 'manifest.json'), 'utf8')) as DiskManifest
  } catch {
    return { error: 'No readable manifest.json in that folder' }
  }
  if (manifest.kind !== 'extension') {
    return { error: 'Not a native extension (manifest.kind must be "extension")' }
  }
  const id = typeof manifest.id === 'string' ? manifest.id.toLowerCase() : ''
  if (!ID_RE.test(id)) return { error: 'manifest.id must be lowercase alphanumeric (a-z0-9._-), no ".."' }
  if (typeof manifest.name !== 'string' || !manifest.name) return { error: 'manifest.name required' }
  const apiVersion = typeof manifest.apiVersion === 'number' ? manifest.apiVersion : 0
  if (apiVersion > SUPPORTED_API_VERSION) return { error: 'This extension needs a newer version of Garret' }

  const nodeEntry = containedPath(base, manifest.node)
  if (!nodeEntry) return { error: 'manifest.node must be a path inside the extension (no "..")' }
  const uiDir = containedPath(base, manifest.ui)
  if (!uiDir) return { error: 'manifest.ui must be a path inside the extension (no "..")' }
  // Both must exist as the right kind of thing (checked without following symlinks).
  try {
    const ns = await lstat(nodeEntry)
    if (!ns.isFile()) return { error: `manifest.node not found: ${String(manifest.node)}` }
    const us = await lstat(uiDir)
    if (!us.isDirectory()) return { error: `manifest.ui is not a directory: ${String(manifest.ui)}` }
    const idx = await lstat(join(uiDir, 'index.html'))
    if (!idx.isFile()) return { error: 'manifest.ui must contain index.html' }
  } catch {
    return { error: 'manifest.node / manifest.ui path does not exist' }
  }

  const ds = manifest.defaultSize
  const defaultSize =
    ds && typeof ds === 'object' && typeof (ds as Record<string, unknown>).w === 'number' && typeof (ds as Record<string, unknown>).h === 'number'
      ? { w: (ds as { w: number }).w, h: (ds as { h: number }).h }
      : undefined

  return {
    id,
    name: manifest.name,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    nodeEntry,
    uiDir,
    declared: { binaries: toStringArray(manifest.binaries), network: toStringArray(manifest.network) },
    defaultSize
  }
}

// ---- record I/O (serialized + atomic) ---------------------------------------------------------

function recordPath(id: string): string {
  return join(nativeExtensionsDir(), id, RECORD_FILE)
}

export async function readRecord(id: string): Promise<ExtRecord | null> {
  try {
    return JSON.parse(await readFile(recordPath(id), 'utf8')) as ExtRecord
  } catch {
    return null
  }
}

let recordWriteChain: Promise<unknown> = Promise.resolve()
function queueRecordWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = recordWriteChain.then(fn, fn)
  recordWriteChain = next.catch(() => undefined)
  return next as Promise<T>
}
async function writeRecordAtomic(id: string, rec: ExtRecord): Promise<void> {
  const path = recordPath(id)
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(rec, null, 2))
  await rename(tmp, path)
}

// ---- install (plan → commit) ------------------------------------------------------------------

/** Validate a source folder and produce a plan (writes nothing). */
export async function planInstall(srcDir: string): Promise<NativeInstallPlan> {
  const spec = await parseManifestSpec(srcDir)
  if ('error' in spec) return fail(spec.error)

  let sourceHash: string
  try {
    sourceHash = await hashFiles(await collectFiles(srcDir))
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }

  const prior = await readRecord(spec.id)
  return {
    ok: true,
    id: spec.id,
    name: spec.name,
    description: spec.description,
    version: spec.version,
    source: srcDir,
    declared: spec.declared,
    isUpdate: prior !== null,
    codeChanged: !prior || prior.sha256 !== sourceHash,
    sourceHash
  }
}

/**
 * Commit an install the user confirmed. Re-collects + re-hashes the source (TOCTOU guard),
 * copies into a same-filesystem temp dir, atomically renames into place, then writes the
 * HMAC-signed record. `enabled` is FALSE on fresh install; on update it is preserved as true ONLY
 * when the code is byte-identical AND the prior record's MAC verified — any code change forces
 * re-consent (design §rev2). Nothing runs until the user enables it (setEnabled).
 */
export async function commitInstall(plan: NativeInstallPlan): Promise<{ ok: boolean; error?: string }> {
  try {
    const files = await collectFiles(plan.source)
    const hash = await hashFiles(files)
    if (hash !== plan.sourceHash) return { ok: false, error: 'Source changed since consent — aborted' }

    // Re-derive identity + declared from the (now hash-verified) source manifest — never trust the
    // renderer-supplied plan at the filesystem boundary.
    const spec = await parseManifestSpec(plan.source)
    if ('error' in spec) return { ok: false, error: spec.error }

    const prior = await readRecord(spec.id)
    const codeUnchanged = prior !== null && prior.sha256 === hash
    const carryEnabled = codeUnchanged && recordMacOk(prior) && prior.enabled

    const extDir = nativeExtensionsDir()
    const dest = join(extDir, spec.id)
    const tmp = join(extDir, `.tmp-${spec.id}-${randomUUID().slice(0, 8)}`)
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
      declared: spec.declared,
      enabled: carryEnabled, // false on fresh install / any code change
      installedAt: Date.now()
    }
    record.mac = signRecord(record) ?? undefined
    await writeFile(join(tmp, RECORD_FILE), JSON.stringify(record, null, 2))
    await rm(dest, { recursive: true, force: true })
    await rename(tmp, dest) // same filesystem → atomic
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- `.garret` staging (native policy: allow all but .node, bigger caps) ----------------------

const stagingDirs = new Set<string>()

export async function planInstallFromFile(garretPath: string): Promise<NativeInstallPlan> {
  const dir = join(tmpdir(), `garret-ext-${randomUUID()}`)
  try {
    await mkdir(dir, { recursive: true })
    stagingDirs.add(dir)
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
  if (!stagingDirs.has(dir)) return
  stagingDirs.delete(dir)
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

// ---- enable / remove / list -------------------------------------------------------------------

/**
 * Flip the enable flag (the crown jewel). The renderer MUST have shown the full-access consent
 * before calling with `on = true`. Refuses if the record can't be authenticated or the files no
 * longer match what was installed — those mean "reinstall", not "enable a mystery". Re-signs the
 * record so the new `enabled` value is authenticated; fails closed if the MAC can't be produced.
 */
export async function setEnabled(id: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!ID_RE.test(id)) return { ok: false, error: 'bad id' }
  return queueRecordWrite(async () => {
    const rec = await readRecord(id)
    if (!rec || rec.id !== id) return { ok: false, error: 'not installed' }
    if (!recordMacOk(rec)) return { ok: false, error: 'Integrity check failed — reinstall this extension' }
    const cur = await currentHash(id)
    if (cur !== rec.sha256) return { ok: false, error: 'Files changed since install — reinstall this extension' }
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
  await rm(join(nativeExtensionsDir(), id), { recursive: true, force: true })
}

/** All installed extensions (for Manage) — with authenticity + tamper flags computed. */
export async function listInstalled(): Promise<InstalledExtension[]> {
  let entries: string[]
  try {
    entries = await readdir(nativeExtensionsDir())
  } catch {
    return []
  }
  const out: InstalledExtension[] = []
  for (const id of entries) {
    if (!ID_RE.test(id)) continue
    const dir = join(nativeExtensionsDir(), id)
    try {
      if (!(await lstat(dir)).isDirectory()) continue
    } catch {
      continue
    }
    const spec = await parseManifestSpec(dir)
    if ('error' in spec || spec.id !== id) continue // not a valid native extension in the right dir
    const rec = await readRecord(id)
    if (!rec) continue
    const integrityOk = rec.id === id && recordMacOk(rec)
    const tampered = (await currentHash(id)) !== rec.sha256
    out.push({
      id,
      name: spec.name,
      version: rec.version,
      source: rec.source,
      declared: rec.declared,
      enabled: rec.enabled && integrityOk && !tampered,
      tampered,
      integrityOk,
      defaultSize: spec.defaultSize
    })
  }
  return out
}

/** A native extension resolved for the board loader / host launch. */
export interface ResolvedExtension {
  id: string
  name: string
  nodeEntry: string
  uiDir: string
  defaultSize?: { w: number; h: number }
}

/**
 * The extensions the board may actually load + run: enabled AND authentic AND untampered AND the
 * on-disk manifest still says kind:"extension" in the dir named for its id (the full AND-gate the
 * critic required — B1). This is the ONLY function `lane.ts` should trust for execution.
 */
export async function resolveEnabledRegistry(): Promise<ResolvedExtension[]> {
  const installed = await listInstalled() // already gates kind + id===dirname
  const out: ResolvedExtension[] = []
  for (const ext of installed) {
    if (!ext.enabled) continue // enabled already folds in integrityOk && !tampered
    const spec = await parseManifestSpec(join(nativeExtensionsDir(), ext.id))
    if ('error' in spec) continue
    out.push({ id: ext.id, name: ext.name, nodeEntry: spec.nodeEntry, uiDir: spec.uiDir, defaultSize: spec.defaultSize })
  }
  return out
}
