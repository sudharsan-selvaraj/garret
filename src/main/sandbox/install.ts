import { join, normalize, sep, extname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { lstat, readdir, readFile, writeFile, rm, mkdir, rename, copyFile } from 'node:fs/promises'
import { sandboxWidgetsDir } from './protocol'
import { isBlockedIp } from './net'
import { unpackZip } from './unpack'
import type { InstallPlan } from '@shared/types/sandbox'

/**
 * Install lifecycle for sandboxed third-party widgets. The host-written install record
 * (`.garret-install.json`) is the AUTHORITATIVE permission ceiling — never the widget's
 * own (user-writable) manifest.json. See docs/phase4-design.md §3a.
 */

const SUPPORTED_API_VERSION = 1
const MAX_BYTES = 20 * 1024 * 1024
const MAX_FILES = 200
const ALLOWED_EXT = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.map',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.woff2'
])
/** Leading alphanumeric, lowercase; no `/`, no `..`/leading-dot path forms. */
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const VALID_PERM = /^(service:[a-z0-9._-]+|network:[^\s]+|files:read|storage|openExternal)$/i

export interface InstallRecord {
  source: string
  version: string
  sha256: string
  consentedPermissions: string[]
  /** Capabilities the widget TRIED but wasn't granted (undeclared attempts) — disclosure. */
  attemptedBlocked: string[]
  enabled: boolean
  installedAt: number
}

interface DiskManifest {
  kind?: unknown
  id?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  apiVersion?: unknown
  permissions?: unknown
  defaultSize?: unknown
  minSize?: unknown
  configSchema?: unknown
}

function fail(msg: string): InstallPlan {
  return {
    ok: false,
    error: msg,
    id: '',
    name: '',
    version: '',
    source: '',
    permissions: [],
    isUpdate: false,
    addedPermissions: [],
    sourceHash: ''
  }
}

/** Validate a permission string and reject `network:` with a literal private/reserved IP. */
function permValid(p: string): boolean {
  if (!VALID_PERM.test(p)) return false
  if (p.startsWith('network:')) {
    const host = p.slice('network:'.length).toLowerCase()
    if (isIP(host) && isBlockedIp(host)) return false
  }
  return true
}

/** Recursively collect installable files, enforcing the guards. Throws on any violation. */
async function collectFiles(srcDir: string): Promise<{ rel: string; abs: string }[]> {
  const root = normalize(srcDir)
  const out: { rel: string; abs: string }[] = []
  let bytes = 0

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir)
    for (const name of entries) {
      if (name.startsWith('.')) continue // skip dotfiles (.garret-install.json, .DS_Store, …)
      const abs = join(dir, name)
      // Containment: never escape the source root.
      if (abs !== root && !abs.startsWith(root + sep)) {
        throw new Error(`path escapes source: ${name}`)
      }
      // lstat (do NOT follow) so a symlink can't smuggle in an outside file.
      const st = await lstat(abs)
      if (st.isSymbolicLink()) throw new Error(`symlinks not allowed: ${name}`)
      if (st.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!st.isFile()) continue // skip sockets/fifos/etc
      const ext = extname(abs).toLowerCase()
      if (!ALLOWED_EXT.has(ext)) throw new Error(`file type not allowed: ${name}`)
      bytes += st.size
      if (bytes > MAX_BYTES) throw new Error('widget exceeds 20MB')
      out.push({ rel: relative(root, abs).split(sep).join('/'), abs })
      if (out.length > MAX_FILES) throw new Error('widget has too many files (>200)')
    }
  }

  await walk(root)
  if (!out.some((f) => f.rel === 'manifest.json')) throw new Error('missing manifest.json')
  if (!out.some((f) => f.rel === 'index.html')) throw new Error('missing index.html')
  return out
}

/** Stable integrity hash: sha256 of JSON{ relpath: sha256hex(file) } with sorted keys. */
async function hashFiles(files: { rel: string; abs: string }[]): Promise<string> {
  const map: Record<string, string> = {}
  for (const f of [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))) {
    const buf = await readFile(f.abs)
    map[f.rel] = createHash('sha256').update(buf).digest('hex')
  }
  return createHash('sha256').update(JSON.stringify(map)).digest('hex')
}

function recordPath(id: string): string {
  return join(sandboxWidgetsDir(), id, '.garret-install.json')
}

/** Re-hash the installed files and compare to the recorded sha256 (tamper/corruption check). */
export async function verifyIntegrity(id: string, expected: string): Promise<boolean> {
  if (!ID_RE.test(id) || !expected) return false
  try {
    return (await hashFiles(await collectFiles(join(sandboxWidgetsDir(), id)))) === expected
  } catch {
    return false
  }
}

export async function readRecord(id: string): Promise<InstallRecord | null> {
  try {
    return JSON.parse(await readFile(recordPath(id), 'utf8')) as InstallRecord
  } catch {
    return null
  }
}

interface ManifestSpec {
  id: string
  name: string
  description?: string
  version: string
  permissions: string[]
}

/**
 * Parse + validate a source manifest into the trusted spec (id, name, validated permission
 * set). This is the SINGLE source of truth for identity + the permission ceiling — both
 * planInstall (for the consent screen) and commitInstall (after the hash check) derive from
 * it, so the renderer-supplied plan can never widen what gets written to the record.
 */
async function parseManifestSpec(srcDir: string): Promise<ManifestSpec | { error: string }> {
  let manifest: DiskManifest
  try {
    manifest = JSON.parse(await readFile(join(srcDir, 'manifest.json'), 'utf8')) as DiskManifest
  } catch {
    return { error: 'No readable manifest.json in that folder' }
  }
  // `kind` is the umbrella-format discriminator (default 'widget'). Packs aren't built yet.
  if (manifest.kind === 'pack') return { error: 'Widget packs are not supported yet.' }
  const id = typeof manifest.id === 'string' ? manifest.id.toLowerCase() : ''
  if (!ID_RE.test(id)) return { error: 'manifest.id must be lowercase alphanumeric (a-z0-9._-), no ".."' }
  if (typeof manifest.name !== 'string' || !manifest.name) return { error: 'manifest.name required' }
  const apiVersion = typeof manifest.apiVersion === 'number' ? manifest.apiVersion : 0
  if (apiVersion > SUPPORTED_API_VERSION) return { error: 'This widget needs a newer version of Garret' }
  const rawPerms = Array.isArray(manifest.permissions) ? manifest.permissions : []
  const permissions: string[] = []
  for (const p of rawPerms) {
    if (typeof p !== 'string' || !permValid(p)) return { error: `Invalid permission: ${String(p)}` }
    permissions.push(p.startsWith('network:') ? `network:${p.slice(8).toLowerCase()}` : p)
  }
  return {
    id,
    name: manifest.name,
    description: typeof manifest.description === 'string' ? manifest.description : undefined,
    version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
    permissions
  }
}

/** Validate a source folder and produce a plan (writes nothing). */
export async function planInstall(srcDir: string): Promise<InstallPlan> {
  const spec = await parseManifestSpec(srcDir)
  if ('error' in spec) return fail(spec.error)

  let sourceHash: string
  try {
    sourceHash = await hashFiles(await collectFiles(srcDir))
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }

  const prior = await readRecord(spec.id)
  const isUpdate = prior !== null
  const consented = new Set(prior?.consentedPermissions ?? [])
  const addedPermissions = spec.permissions.filter((p) => !consented.has(p))

  return {
    ok: true,
    id: spec.id,
    name: spec.name,
    description: spec.description,
    version: spec.version,
    source: srcDir,
    permissions: spec.permissions,
    isUpdate,
    addedPermissions,
    sourceHash
  }
}

/**
 * Commit an install the user confirmed. Re-collects + re-hashes the source (TOCTOU guard
 * vs the plan), copies into a same-filesystem temp dir, atomically renames into place, and
 * writes the install record with `consentedPermissions` = the approved set (replace).
 */
export async function commitInstall(plan: InstallPlan): Promise<{ ok: boolean; error?: string }> {
  try {
    const files = await collectFiles(plan.source)
    const hash = await hashFiles(files)
    if (hash !== plan.sourceHash) return { ok: false, error: 'Source changed since consent — aborted' }

    // Re-derive id + permission ceiling from the (now hash-verified) source manifest — never
    // trust the renderer-supplied plan.id / plan.permissions at the filesystem + enforcement
    // boundary. Since the hash matched, this manifest is byte-identical to what was consented.
    const spec = await parseManifestSpec(plan.source)
    if ('error' in spec) return { ok: false, error: spec.error }

    const widgetsDir = sandboxWidgetsDir()
    const dest = join(widgetsDir, spec.id)
    // Unique per-invocation temp dir (random nonce) so concurrent commits can't collide.
    const tmp = join(widgetsDir, `.tmp-${spec.id}-${randomUUID().slice(0, 8)}`)
    await rm(tmp, { recursive: true, force: true })
    await mkdir(tmp, { recursive: true })
    for (const f of files) {
      const target = join(tmp, f.rel)
      await mkdir(join(target, '..'), { recursive: true })
      await copyFile(f.abs, target)
    }
    const prior = await readRecord(spec.id)
    const record: InstallRecord = {
      source: plan.source,
      version: spec.version,
      sha256: hash,
      consentedPermissions: spec.permissions, // replace, never accumulate
      attemptedBlocked: prior?.attemptedBlocked ?? [],
      enabled: prior?.enabled ?? true,
      installedAt: Date.now()
    }
    await writeFile(join(tmp, '.garret-install.json'), JSON.stringify(record, null, 2))
    await rm(dest, { recursive: true, force: true })
    await rename(tmp, dest) // same filesystem → atomic
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Temp dirs we extracted a `.garret` into, awaiting consent. Only these may be cleaned up
// (so the cleanup IPC can never be coaxed into deleting an arbitrary path).
const stagingDirs = new Set<string>()

/**
 * Plan an install from a `.garret` file: extract it (slip-safe) into a host-owned temp dir,
 * then run the normal folder `planInstall` against that dir. The temp dir persists through the
 * consent step (its path is the returned plan's `source`); the caller MUST call
 * {@link cleanupStaging} on confirm/cancel. `staged: true` marks it for that cleanup.
 */
export async function planInstallFromFile(garretPath: string): Promise<InstallPlan> {
  const dir = join(tmpdir(), `garret-install-${randomUUID()}`)
  try {
    await mkdir(dir, { recursive: true })
    stagingDirs.add(dir)
    await unpackZip(garretPath, dir)
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

/** Remove a `.garret` staging dir — only ever one we created (never an arbitrary path). */
export async function cleanupStaging(dir: string): Promise<void> {
  if (!stagingDirs.has(dir)) return
  stagingDirs.delete(dir)
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}

export async function removeWidget(id: string): Promise<void> {
  if (!ID_RE.test(id)) return
  await rm(join(sandboxWidgetsDir(), id), { recursive: true, force: true })
}

export async function setEnabled(id: string, enabled: boolean): Promise<void> {
  if (!ID_RE.test(id)) return // never let an unvalidated id reach a filesystem path
  const rec = await readRecord(id)
  if (!rec) return
  await writeFile(recordPath(id), JSON.stringify({ ...rec, enabled }, null, 2))
}

/** Merge capabilities a running widget attempted-but-was-denied into its record (disclosure). */
export async function recordUsage(id: string, attemptedBlocked: string[]): Promise<void> {
  if (!ID_RE.test(id) || !Array.isArray(attemptedBlocked)) return
  // Fire-and-forget from an ipcMain.on sender — must NOT reject (it would become an
  // unhandled rejection that can crash the main process).
  try {
    const rec = await readRecord(id)
    if (!rec) return
    const caps = attemptedBlocked.filter((c) => typeof c === 'string')
    const merged = [...new Set([...(rec.attemptedBlocked ?? []), ...caps])]
    if (merged.length === (rec.attemptedBlocked?.length ?? 0)) return // nothing new
    await writeFile(recordPath(id), JSON.stringify({ ...rec, attemptedBlocked: merged }, null, 2))
  } catch {
    /* disclosure is best-effort; never crash main over it */
  }
}
