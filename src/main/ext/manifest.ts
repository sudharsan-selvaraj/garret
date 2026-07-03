import { normalize, join, sep } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import type { ExtTier } from '@shared/types/ext'

/**
 * Parse + validate `garret.manifest.json` into the trusted spec, and DERIVE the tier from declared
 * capabilities (never chosen). The one place the tier + require-both rule live. See
 * docs/architecture.md § Pre-SDK resolutions (tier inference) and § 10 (reject unimplemented caps).
 */

export const MANIFEST_FILE = 'garret.manifest.json'
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/
const SUPPORTED_API_VERSION = 1

/** Capabilities Garret actually implements. Anything else (e.g. `window`) is rejected at install.
 *  `windows` (open floating sibling surfaces) is a SIMPLE cap — it does not force the full tier, so a
 *  web-tier widget may open a pure-UI floating surface. See docs/floating-surface-windows.md. */
const SIMPLE_CAPS = new Set(['storage', 'secrets', 'notify', 'clipboard', 'openExternal', 'process', 'fs', 'native', 'windows'])
/** Caps that require a host process (full-access tier). */
const SYSTEM_CAPS = new Set(['process', 'fs', 'native'])

/** A secondary, non-placeable UI surface a widget can open as a floating window (same package only). */
export interface SurfaceSpec {
  name: string
  /** absolute, contained. */
  uiDir: string
  /** window size in PX (not grid units). */
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  resizable: boolean
}

export interface ExtSpec {
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  /** absolute, contained. */
  uiDir: string
  /** absolute, contained. Present ⇒ full tier. */
  nodeEntry?: string
  capabilities: string[]
  tier: ExtTier
  defaultSize?: { w: number; h: number }
  /** Secondary openable surfaces, keyed by surfaceId. Requires the `windows` capability. */
  surfaces?: Record<string, SurfaceSpec>
  config?: Record<string, unknown>
}

interface DiskManifest {
  id?: unknown
  name?: unknown
  version?: unknown
  apiVersion?: unknown
  description?: unknown
  icon?: unknown
  ui?: unknown
  host?: unknown
  capabilities?: unknown
  defaultSize?: unknown
  surfaces?: unknown
  config?: unknown
}

/** Parse a `{ w, h }` px size, or undefined. */
function pxSize(v: unknown): { w: number; h: number } | undefined {
  const s = v as { w?: unknown; h?: unknown } | undefined
  return s && typeof s.w === 'number' && typeof s.h === 'number' ? { w: s.w, h: s.h } : undefined
}

/** Validate a manifest-relative path is contained (no absolute, no `..`); strips trailing sep. */
function containedPath(base: string, rel: unknown): string | null {
  if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(rel)) return null
  let p = normalize(join(base, rel))
  while (p.length > 1 && p.endsWith(sep)) p = p.slice(0, -1)
  return p === base || p.startsWith(base + sep) ? p : null
}

/** Returns the normalized capability, or null if unknown/unimplemented (rejected). */
function normalizeCapability(c: unknown): string | null {
  if (typeof c !== 'string') return null
  if (SIMPLE_CAPS.has(c)) return c
  if (/^network:\S+$/.test(c)) return `network:${c.slice(8).toLowerCase()}`
  if (/^service:[a-z0-9._-]+$/i.test(c)) return c.toLowerCase()
  return null
}

function isSystemCap(c: string): boolean {
  return SYSTEM_CAPS.has(c) || c === 'network:*'
}

export async function parseManifest(dir: string): Promise<ExtSpec | { error: string }> {
  const base = normalize(dir)
  let m: DiskManifest
  try {
    m = JSON.parse(await readFile(join(base, MANIFEST_FILE), 'utf8')) as DiskManifest
  } catch {
    return { error: `No readable ${MANIFEST_FILE} in that folder` }
  }

  const id = typeof m.id === 'string' ? m.id.toLowerCase() : ''
  if (!ID_RE.test(id)) return { error: 'manifest.id must be lowercase alphanumeric (a-z0-9._-), no ".."' }
  if (typeof m.name !== 'string' || !m.name) return { error: 'manifest.name required' }
  const apiVersion = typeof m.apiVersion === 'number' ? m.apiVersion : 0
  if (apiVersion > SUPPORTED_API_VERSION) return { error: 'This extension needs a newer version of Garret' }

  const uiDir = containedPath(base, m.ui)
  if (!uiDir) return { error: 'manifest.ui must be a path inside the extension (no "..")' }
  try {
    if (!(await lstat(uiDir)).isDirectory()) return { error: 'manifest.ui is not a directory' }
    if (!(await lstat(join(uiDir, 'index.html'))).isFile()) return { error: 'manifest.ui must contain index.html' }
  } catch {
    return { error: 'manifest.ui / index.html not found' }
  }

  let nodeEntry: string | undefined
  if (m.host !== undefined) {
    const p = containedPath(base, m.host)
    if (!p) return { error: 'manifest.host must be a path inside the extension (no "..")' }
    try {
      if (!(await lstat(p)).isFile()) return { error: 'manifest.host not found' }
    } catch {
      return { error: 'manifest.host not found' }
    }
    nodeEntry = p
  }

  const rawCaps = Array.isArray(m.capabilities) ? m.capabilities : []
  const capabilities: string[] = []
  for (const c of rawCaps) {
    const norm = normalizeCapability(c)
    if (!norm) return { error: `Unsupported capability: ${String(c)}` }
    capabilities.push(norm)
  }

  // Tier = require BOTH a host and a system capability (docs § Pre-SDK resolutions).
  const hasHost = nodeEntry !== undefined
  const hasSystemCap = capabilities.some(isSystemCap)
  if (hasHost && !hasSystemCap) {
    return { error: 'A host entry requires at least one system capability (process / fs / native).' }
  }
  if (!hasHost && hasSystemCap) {
    return { error: 'A system capability (process / fs / native / network:*) requires a host entry.' }
  }
  const tier: ExtTier = hasHost && hasSystemCap ? 'full' : 'web'

  const defaultSize = pxSize(m.defaultSize)

  // Secondary surfaces (openable as floating windows). Each is validated like the primary ui
  // (contained path + dir + index.html); declaring any requires the `windows` capability.
  let surfaces: Record<string, SurfaceSpec> | undefined
  if (m.surfaces !== undefined) {
    if (typeof m.surfaces !== 'object' || m.surfaces === null || Array.isArray(m.surfaces)) {
      return { error: 'manifest.surfaces must be an object' }
    }
    const out: Record<string, SurfaceSpec> = {}
    for (const [sid, raw] of Object.entries(m.surfaces as Record<string, unknown>)) {
      if (!ID_RE.test(sid)) return { error: `Invalid surface id: ${sid}` }
      const s = raw as { name?: unknown; ui?: unknown; defaultSize?: unknown; minSize?: unknown; resizable?: unknown }
      if (typeof s.name !== 'string' || !s.name) return { error: `surface "${sid}" requires a name` }
      const sDir = containedPath(base, s.ui)
      if (!sDir) return { error: `surface "${sid}" ui must be a path inside the extension (no "..")` }
      try {
        if (!(await lstat(sDir)).isDirectory()) return { error: `surface "${sid}" ui is not a directory` }
        if (!(await lstat(join(sDir, 'index.html'))).isFile()) return { error: `surface "${sid}" ui must contain index.html` }
      } catch {
        return { error: `surface "${sid}" ui / index.html not found` }
      }
      out[sid] = {
        name: s.name,
        uiDir: sDir,
        defaultSize: pxSize(s.defaultSize),
        minSize: pxSize(s.minSize),
        resizable: s.resizable !== false // default true
      }
    }
    if (Object.keys(out).length > 0) {
      if (!capabilities.includes('windows')) {
        return { error: 'Declaring surfaces requires the "windows" capability.' }
      }
      surfaces = out
    }
  }

  return {
    id,
    name: m.name,
    version: typeof m.version === 'string' ? m.version : '0.0.0',
    description: typeof m.description === 'string' ? m.description : undefined,
    icon: typeof m.icon === 'string' ? m.icon : undefined,
    uiDir,
    nodeEntry,
    capabilities,
    tier,
    defaultSize,
    surfaces,
    config: m.config && typeof m.config === 'object' ? (m.config as Record<string, unknown>) : undefined
  }
}
