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

/** Capabilities Garret actually implements. Anything else (e.g. `window`) is rejected at install. */
const SIMPLE_CAPS = new Set(['storage', 'secrets', 'notify', 'clipboard', 'openExternal', 'process', 'fs', 'native'])
/** Caps that require a host process (full-access tier). */
const SYSTEM_CAPS = new Set(['process', 'fs', 'native'])

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
  config?: unknown
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

  const ds = m.defaultSize as { w?: unknown; h?: unknown } | undefined
  const defaultSize =
    ds && typeof ds.w === 'number' && typeof ds.h === 'number' ? { w: ds.w, h: ds.h } : undefined

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
    config: m.config && typeof m.config === 'object' ? (m.config as Record<string, unknown>) : undefined
  }
}
