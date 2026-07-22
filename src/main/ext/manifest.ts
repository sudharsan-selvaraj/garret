import { normalize, join, sep } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import {
  MANIFEST_FILE,
  validateManifest,
  normalizeCapability,
  parseSettingsSchema,
  parseNotifier,
  pxSize,
  winSize,
  isContainedRel,
  type SettingsField,
  type NotifierSpec
} from '@garretapp/pack-schema'

/**
 * Parse `garret.manifest.json` into the trusted, RESOLVED spec (absolute ui/host paths). The rulebook
 * — shape, ids, capabilities, path containment, sizes — lives in @garretapp/pack-schema
 * (`validateManifest`), shared with the `garret` CLI so `audit` == install. This module adds only what
 * needs the filesystem: resolving relative paths to absolute + verifying the referenced files exist.
 */

export { MANIFEST_FILE }

/** A secondary, non-placeable UI surface a widget can open as a floating window (same package only). */
export interface SurfaceSpec {
  name: string
  /** absolute, contained. */
  uiDir: string
  /** window size in PX (not grid units). */
  defaultSize?: { w: number; h: number }
  minSize?: { w: number; h: number }
  resizable: boolean
  /** native window chrome (title bar); default true. */
  frame: boolean
  /** transparent background — for non-rectangular UIs (e.g. a phone screen); default false. */
  transparent: boolean
}

export interface WidgetSpec {
  /** widget key, unique within the pack (single segment, no dots/slashes). */
  id: string
  /** the permanent identity `${packId}/${id}` — the board layout + storage key. */
  fullId: string
  name: string
  description?: string
  icon?: string
  /** pack-relative preview image (screenshot) shown in the Add-widget gallery. */
  preview?: string
  uiDir: string
  /** present ⇒ the widget ships a raw-Node host (system access → the warning). */
  nodeEntry?: string
  capabilities: string[]
  defaultSize?: { w: number; h: number }
  surfaces?: Record<string, SurfaceSpec>
  settingsSchema?: SettingsField[]
  notifier?: NotifierSpec
}

export interface PackSpec {
  /** publisher-namespaced pack id (e.g. `acme.devtools`). */
  id: string
  publisher: string
  name: string
  version: string
  description?: string
  /** pack icon — a relative image path in the pack (e.g. `icon.png`). */
  icon?: string
  /** pack README — a relative markdown path in the pack (default `README.md`). */
  readme?: string
  widgets: WidgetSpec[]
  /** opt-in pack-shared settings schema (values live in `ext-data/<packId>/_shared/`). */
  shared?: { settingsSchema?: SettingsField[] }
  /** union of widget caps — for display; enforcement is per-widget at the broker. */
  capabilities: string[]
}

/** Resolve a manifest-relative path to an absolute, contained path (defense-in-depth over the schema's
 *  string check); strips a trailing sep. Returns null if not contained. */
function containedPath(base: string, rel: unknown): string | null {
  if (!isContainedRel(rel)) return null
  let p = normalize(join(base, rel))
  while (p.length > 1 && p.endsWith(sep)) p = p.slice(0, -1)
  return p === base || p.startsWith(base + sep) ? p : null
}

/** Resolve one already-validated surface entry, verifying its ui exists on disk. */
async function resolveSurfaces(
  base: string,
  raw: Record<string, unknown>
): Promise<Record<string, SurfaceSpec> | { error: string }> {
  const out: Record<string, SurfaceSpec> = {}
  for (const [sid, sraw] of Object.entries(raw)) {
    const s = sraw as { name: string; ui: unknown; defaultSize?: unknown; minSize?: unknown; resizable?: unknown; frame?: unknown; transparent?: unknown }
    const sDir = containedPath(base, s.ui)
    if (!sDir) return { error: `surface "${sid}" ui must be a path inside the pack (no "..")` }
    try {
      if (!(await lstat(sDir)).isDirectory()) return { error: `surface "${sid}" ui is not a directory` }
      if (!(await lstat(join(sDir, 'index.html'))).isFile()) return { error: `surface "${sid}" ui must contain index.html` }
    } catch {
      return { error: `surface "${sid}" ui / index.html not found` }
    }
    out[sid] = {
      name: s.name,
      uiDir: sDir,
      defaultSize: (s.defaultSize !== undefined ? winSize(s.defaultSize) : undefined) ?? undefined,
      minSize: (s.minSize !== undefined ? winSize(s.minSize) : undefined) ?? undefined,
      resizable: s.resizable !== false,
      frame: s.frame !== false,
      transparent: s.transparent === true
    }
  }
  return out
}

/** Resolve one already-validated widget entry into a spec, verifying its ui/host/surfaces on disk. */
async function resolveWidget(base: string, packId: string, raw: unknown): Promise<WidgetSpec | { error: string }> {
  const w = raw as Record<string, unknown>
  const id = (w.id as string).toLowerCase()

  const uiDir = containedPath(base, w.ui)
  if (!uiDir) return { error: `widget "${id}" ui must be a path inside the pack (no "..")` }
  try {
    if (!(await lstat(uiDir)).isDirectory()) return { error: `widget "${id}" ui is not a directory` }
    if (!(await lstat(join(uiDir, 'index.html'))).isFile()) return { error: `widget "${id}" ui must contain index.html` }
  } catch {
    return { error: `widget "${id}" ui / index.html not found` }
  }

  let nodeEntry: string | undefined
  if (w.host !== undefined) {
    const p = containedPath(base, w.host)
    if (!p) return { error: `widget "${id}" host must be a path inside the pack (no "..")` }
    try {
      if (!(await lstat(p)).isFile()) return { error: `widget "${id}" host not found` }
    } catch {
      return { error: `widget "${id}" host not found` }
    }
    nodeEntry = p
  }

  let surfaces: Record<string, SurfaceSpec> | undefined
  if (w.surfaces !== undefined && Object.keys(w.surfaces as object).length > 0) {
    const s = await resolveSurfaces(base, w.surfaces as Record<string, unknown>)
    if ('error' in s) return { error: `widget "${id}": ${s.error}` }
    surfaces = s
  }

  return {
    id,
    fullId: `${packId}/${id}`,
    name: w.name as string,
    description: typeof w.description === 'string' ? w.description : undefined,
    icon: typeof w.icon === 'string' ? w.icon : undefined,
    preview: typeof w.preview === 'string' ? w.preview : undefined,
    uiDir,
    nodeEntry,
    capabilities: (Array.isArray(w.capabilities) ? w.capabilities : [])
      .map(normalizeCapability)
      .filter((c): c is string => c !== null),
    defaultSize: pxSize(w.defaultSize),
    surfaces,
    settingsSchema: parseSettingsSchema((w.settings as { schema?: unknown })?.schema),
    notifier: parseNotifier(w.notifier)
  }
}

/** Parse + validate a v2 pack manifest, then resolve paths + verify files. v1 manifests are rejected. */
export async function parsePack(dir: string): Promise<PackSpec | { error: string }> {
  const base = normalize(dir)
  let m: Record<string, unknown>
  try {
    m = JSON.parse(await readFile(join(base, MANIFEST_FILE), 'utf8')) as Record<string, unknown>
  } catch {
    return { error: `No readable ${MANIFEST_FILE} in that folder` }
  }

  // The rulebook: everything that doesn't need the filesystem. First error wins (preserves the
  // fail-fast install contract); warnings (lenient settings/notifier) are non-fatal.
  const firstError = validateManifest(m).find((i) => i.level === 'error')
  if (firstError) return { error: firstError.message }

  const id = (m.id as string).toLowerCase()
  const publisher = (m.publisher as string).toLowerCase()

  const widgets: WidgetSpec[] = []
  for (const raw of m.widgets as unknown[]) {
    const w = await resolveWidget(base, id, raw)
    if ('error' in w) return w
    widgets.push(w)
  }

  const capabilities = [...new Set(widgets.flatMap((w) => w.capabilities))]

  let shared: PackSpec['shared']
  if (m.shared !== undefined) {
    shared = { settingsSchema: parseSettingsSchema((m.shared as { settings?: { schema?: unknown } })?.settings?.schema) }
  }

  return {
    id,
    publisher,
    name: m.name as string,
    version: typeof m.version === 'string' ? m.version : '0.0.0',
    description: typeof m.description === 'string' ? m.description : undefined,
    icon: typeof m.icon === 'string' ? m.icon : undefined,
    readme: typeof m.readme === 'string' ? m.readme : undefined,
    widgets,
    shared,
    capabilities
  }
}
